/**
 * Swarm dispatcher — finds ready subtasks (deps all 'succeeded') and queues
 * them as parallel ops.run rows. Hooked from two places:
 *
 *   1. `POST /api/goals/:id/dispatch-swarm` — operator kicks the goal off.
 *   2. `worker.ts` after a terminal status — the just-finished run might
 *      be a subtask whose completion unblocks one or more dependents.
 *
 * Both call `cascadeFromRun()` (or `dispatchReadySubtasks()` for the
 * cold-start case). The function is idempotent — safe to call multiple
 * times; it only acts on subtasks whose status moves between states.
 *
 * Failure semantics: if a subtask's dependent transitively fails, the
 * dependents (and their descendants) move to 'cancelled' rather than
 * remaining 'pending'. Operators can re-plan + re-dispatch; we never
 * silently leave half-done work in pending forever.
 *
 * Must run inside a `withOrgScope()` (or `withSystemScope()`) transaction.
 */

import type pg from "pg";

import { audit } from "../audit.js";
import type { Scope } from "../schemas.js";

type SubtaskRow = {
  id: string;
  org_id: string;
  goal_id: string;
  ordinal: number;
  title: string;
  instruction: string;
  agent_kind: string;
  skill_slug: string | null;
  depends_on: string[];
  status: string;
  run_id: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS = `
  id, org_id, goal_id, ordinal, title, instruction, agent_kind, skill_slug,
  depends_on, status, run_id, output, error, created_at, updated_at
`;

/**
 * Cold-start dispatch: walk every pending subtask of this goal, hop the
 * ones whose deps are already 'succeeded' (or who have no deps) to
 * 'ready' → 'queued' + create the runs.
 */
export async function dispatchReadySubtasks(
  client: pg.PoolClient,
  goalId: string,
  scope: Scope,
): Promise<{ queued_subtask_ids: string[]; queued_run_ids: string[] }> {
  const { rows: subtasks } = await client.query<SubtaskRow>(
    `SELECT ${COLUMNS} FROM ops.subtask
      WHERE goal_id = $1 AND org_id = $2
      ORDER BY ordinal ASC`,
    [goalId, scope.org_id],
  );
  if (subtasks.length === 0) return { queued_subtask_ids: [], queued_run_ids: [] };

  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const ready = subtasks.filter(
    (s) =>
      s.status === "pending" &&
      s.depends_on.every((d) => byId.get(d)?.status === "succeeded"),
  );
  return queueSubtasks(client, goalId, ready, scope);
}

/**
 * Worker-side cascade: a run just reached a terminal status. If it was
 * created from a subtask, transition that subtask + look for newly-ready
 * dependents. If the subtask failed, transitively cancel its dependent
 * subtree so the goal doesn't sit half-done.
 */
export async function cascadeFromRun(
  client: pg.PoolClient,
  runId: string,
  runStatus: "succeeded" | "failed" | "cancelled",
  runOutput: Record<string, unknown> | null,
  runError: string | null,
  scope: Scope,
): Promise<{ queued_subtask_ids: string[]; queued_run_ids: string[] } | null> {
  const { rows } = await client.query<SubtaskRow>(
    `SELECT ${COLUMNS} FROM ops.subtask
      WHERE run_id = $1 AND org_id = $2`,
    [runId, scope.org_id],
  );
  if (rows.length === 0) return null;
  const subtask = rows[0]!;

  const newStatus =
    runStatus === "succeeded"
      ? "succeeded"
      : runStatus === "failed"
        ? "failed"
        : "cancelled";
  await client.query(
    `UPDATE ops.subtask
        SET status = $2,
            output = $3::jsonb,
            error  = $4,
            updated_at = now()
      WHERE id = $1`,
    [
      subtask.id,
      newStatus,
      runOutput ? JSON.stringify(runOutput) : null,
      runError,
    ],
  );
  await audit(
    {
      scope,
      action: "subtask.terminal",
      target_type: "subtask",
      target_id: subtask.id,
      metadata: {
        goal_id: subtask.goal_id,
        run_id: runId,
        status: newStatus,
      },
    },
    client,
  );

  if (newStatus === "succeeded") {
    return await dispatchReadySubtasks(client, subtask.goal_id, scope);
  }

  if (newStatus === "failed" || newStatus === "cancelled") {
    await cancelDependents(client, subtask.goal_id, [subtask.id], scope);
  }
  return { queued_subtask_ids: [], queued_run_ids: [] };
}

// -- internals -------------------------------------------------------------

async function queueSubtasks(
  client: pg.PoolClient,
  goalId: string,
  subtasks: SubtaskRow[],
  scope: Scope,
): Promise<{ queued_subtask_ids: string[]; queued_run_ids: string[] }> {
  const queued_subtask_ids: string[] = [];
  const queued_run_ids: string[] = [];
  for (const s of subtasks) {
    const { rows: runRows } = await client.query<{ id: string }>(
      `INSERT INTO ops.run (goal_id, status, input)
       VALUES ($1, 'queued', $2::jsonb)
       RETURNING id`,
      [
        goalId,
        JSON.stringify({
          subtask_id: s.id,
          ordinal: s.ordinal,
          title: s.title,
          instruction: s.instruction,
          agent_kind: s.agent_kind,
          skill_slug: s.skill_slug,
        }),
      ],
    );
    const runId = runRows[0]!.id;
    await client.query(
      `UPDATE ops.subtask
          SET status = 'queued',
              run_id = $2,
              updated_at = now()
        WHERE id = $1 AND status IN ('pending','ready')`,
      [s.id, runId],
    );
    await audit(
      {
        scope,
        action: "subtask.queue",
        target_type: "subtask",
        target_id: s.id,
        metadata: { goal_id: goalId, run_id: runId, ordinal: s.ordinal },
      },
      client,
    );
    queued_subtask_ids.push(s.id);
    queued_run_ids.push(runId);
  }
  return { queued_subtask_ids, queued_run_ids };
}

async function cancelDependents(
  client: pg.PoolClient,
  goalId: string,
  failedIds: string[],
  scope: Scope,
): Promise<void> {
  const seen = new Set(failedIds);
  let frontier = failedIds.slice();
  while (frontier.length > 0) {
    const { rows } = await client.query<SubtaskRow>(
      `SELECT ${COLUMNS} FROM ops.subtask
        WHERE goal_id = $1 AND org_id = $2
          AND depends_on && $3::uuid[]
          AND status IN ('pending','ready','queued')`,
      [goalId, scope.org_id, frontier],
    );
    const next: string[] = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      next.push(r.id);
      await client.query(
        `UPDATE ops.subtask
            SET status = 'cancelled',
                error = COALESCE(error, 'cancelled — upstream subtask failed'),
                updated_at = now()
          WHERE id = $1`,
        [r.id],
      );
      await audit(
        {
          scope,
          action: "subtask.cancel_cascade",
          target_type: "subtask",
          target_id: r.id,
          metadata: { goal_id: goalId, reason: "upstream_failed" },
        },
        client,
      );
    }
    frontier = next;
  }
}
