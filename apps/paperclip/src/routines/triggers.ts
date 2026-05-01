/**
 * Routine triggers — the Cadence pillar's binding model.
 *
 * Three kinds of trigger fire a routine goal:
 *   - schedule  → the cron-driven scheduler (already in scheduler.ts)
 *   - event     → audit_log entry matches a pattern (e.g. "every time a
 *                 decision is approved, run the follow-up routine")
 *   - api       → POST /api/routines/triggers/:token/fire is hit
 *
 * The trigger row lives in ops.routine_trigger and references the routine
 * goal it fires. A single routine can have multiple triggers (e.g. "every
 * Monday morning OR whenever I forward a thread to agent@blankcollar.ai").
 *
 * This module owns the dispatch path. The scheduler.ts module imports it
 * and calls fireRoutineFromTrigger() when a trigger condition is met.
 */

import type pg from "pg";

import { audit } from "../audit.js";
import { generatePlan } from "../plan.js";
import type { Scope } from "../schemas.js";

export type TriggerRow = {
  id: string;
  goal_id: string;
  trigger_kind: "schedule" | "event" | "api";
  trigger_spec: Record<string, unknown>;
  enabled: boolean;
  last_fired_at: string | null;
};

/**
 * Match an audit_log entry against a trigger's event spec.
 *
 * Spec shape:
 *   { "action": "decision.approve" }                       ← match action exactly
 *   { "action": "goal.create", "match": {                  ← match on metadata too
 *     "metadata.kind": "standing"
 *   }}
 *
 * Dotted paths into metadata are supported one level deep. v0 only checks
 * equality; ranges / regex come with the policy engine in Phase 5.
 */
export function matchesEvent(
  spec: Record<string, unknown>,
  event: { action: string; metadata: Record<string, unknown> },
): boolean {
  const expectedAction = spec.action as string | undefined;
  if (expectedAction && expectedAction !== event.action) return false;

  const match = (spec.match ?? {}) as Record<string, unknown>;
  for (const [key, expected] of Object.entries(match)) {
    if (key.startsWith("metadata.")) {
      const path = key.slice("metadata.".length);
      const actual = (event.metadata ?? {})[path];
      if (actual !== expected) return false;
    } else if (key === "action") {
      if (event.action !== expected) return false;
    }
  }
  return true;
}

/**
 * Fire the routine goal for a trigger row. Generates a plan from the goal
 * and queues one run per subtask. Reuses generatePlan() — same path as
 * POST /api/goals/:id/dispatch-all and the schedule-driven path in
 * scheduler.ts.
 */
export async function fireRoutineFromTrigger(
  client: pg.PoolClient,
  trigger: TriggerRow,
  causeMetadata: Record<string, unknown>,
): Promise<{ run_count: number }> {
  const { rows: goalRows } = await client.query<{
    id: string;
    org_id: string;
    title: string;
    description: string | null;
  }>(
    `SELECT id, org_id, title, description
       FROM ops.goal
      WHERE id = $1
        AND kind = 'routine'
        AND status IN ('draft','active') FOR UPDATE`,
    [trigger.goal_id],
  );
  if (goalRows.length === 0) return { run_count: 0 };
  const goal = goalRows[0]!;
  const scope: Scope = { org_id: goal.org_id, role: "owner" };

  const subtasks = generatePlan({ title: goal.title, description: goal.description });
  for (const st of subtasks) {
    const { rows: runRows } = await client.query<{ id: string }>(
      `INSERT INTO ops.run (goal_id, status, input)
       VALUES ($1, 'queued', $2::jsonb) RETURNING id`,
      [
        goal.id,
        JSON.stringify({
          subtask: st,
          source: `trigger:${trigger.trigger_kind}`,
          trigger_id: trigger.id,
          ...causeMetadata,
        }),
      ],
    );
    const runId = runRows[0]!.id;
    await audit(
      {
        scope,
        action: "run.dispatch",
        target_type: "run",
        target_id: runId,
        metadata: {
          goal_id: goal.id,
          subtask_index: st.index,
          source: `trigger:${trigger.trigger_kind}`,
          trigger_id: trigger.id,
        },
      },
      client,
    );
  }

  // Bump goal status to active on first fire.
  await client.query(
    `UPDATE ops.goal
        SET status = CASE WHEN status = 'draft' THEN 'active'::ops.goal_status ELSE status END,
            updated_at = now()
      WHERE id = $1`,
    [goal.id],
  );
  await client.query(
    `UPDATE ops.routine_trigger SET last_fired_at = now() WHERE id = $1`,
    [trigger.id],
  );
  return { run_count: subtasks.length };
}
