/**
 * Queue worker.
 *
 * Phase 2: dispatched runs to an in-process fake agent.
 * Phase 3: dispatches to a real adapter HTTP service (Hermes / OpenClaw),
 *   polls it until terminal, mirrors state into ops.run, writes audit entries.
 *
 * Selection rule: a subtask may carry `subtask.agent_kind`. If unset, fall
 * back to "hermes". A row in ops.agent of that kind (active) becomes
 * `agent_id` on the run.
 *
 * RLS / scope:
 *   The initial claim has to scan ops.run across orgs (we don't know which
 *   org has work until we find it). That step uses `tx()` directly. Once
 *   the run + its parent goal are claimed, every subsequent DB touch
 *   (agent lookup, succeed/fail/cancel, audit) uses
 *   `withOrgScope(goal.org_id, ...)` so each run's lifecycle is properly
 *   scope-bound. The strict-RLS flip in Phase B will need a privileged
 *   path for the initial cross-org claim (SECURITY DEFINER function or a
 *   BYPASSRLS role); the rest of this worker is already ready.
 */

import { audit } from "../audit.js";
import { config } from "../config.js";
import { tx, withOrgScope } from "../db.js";
import type { Scope } from "../schemas.js";
import type { AdapterClient } from "./adapter-client.js";
import { getAdapter, knownKinds } from "./registry.js";

type Logger = {
  info: (msg: string) => void;
  warn?: (msg: string) => void;
  error: (err: unknown, msg: string) => void;
};

export class Worker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private busyClaim = false;
  private inFlight: Map<string, AdapterClient> = new Map();

  start(log: Logger): void {
    if (this.running) return;
    this.running = true;
    log.info(
      `paperclip worker started (poll=${config.workerPollIntervalMs}ms, kinds=[${knownKinds().join(", ")}])`,
    );
    const tick = async (): Promise<void> => {
      if (!this.running) return;
      if (!this.busyClaim) {
        this.busyClaim = true;
        try {
          await this.claimAndDispatch(log);
        } catch (err) {
          log.error(err, "worker tick failed");
        } finally {
          this.busyClaim = false;
        }
      }
      if (this.running) {
        this.timer = setTimeout(tick, config.workerPollIntervalMs);
      }
    };
    this.timer = setTimeout(tick, 200);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    // Cancel in-flight runs at the adapter layer; the polling loops below will
    // see status=cancelled and finalize the rows.
    for (const [runId, client] of this.inFlight.entries()) {
      void client.cancel(runId);
    }
    // Brief grace period for tick + poll loops to settle.
    for (let i = 0; i < 40 && (this.busyClaim || this.inFlight.size > 0); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** Claim one queued run, dispatch to its adapter, and start polling. */
  private async claimAndDispatch(log: Logger): Promise<void> {
    type ClaimedRun = { id: string; goal_id: string; input: Record<string, unknown> };
    type ClaimedGoal = { id: string; org_id: string; department_id: string | null };

    const claim = await tx(async (client) => {
      const { rows } = await client.query<ClaimedRun>(
        `
        UPDATE ops.run
        SET status = 'running', started_at = now()
        WHERE id = (
          SELECT id FROM ops.run
          WHERE status = 'queued'
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id, goal_id, input
        `,
      );
      if (rows.length === 0) return undefined;
      const run = rows[0]!;
      const { rows: goalRows } = await client.query<ClaimedGoal>(
        "SELECT id, org_id, department_id FROM ops.goal WHERE id = $1",
        [run.goal_id],
      );
      if (goalRows.length === 0) {
        await client.query(
          "UPDATE ops.run SET status = 'failed', error = $2, finished_at = now() WHERE id = $1",
          [run.id, "goal not found"],
        );
        return undefined;
      }
      return { run, goal: goalRows[0]! };
    });

    if (!claim) return;
    const { run, goal } = claim;

    const subtask = (run.input as { subtask?: SubtaskShape }).subtask;
    if (!subtask) {
      await this.fail(run.id, goal, "missing subtask in input");
      return;
    }

    const kind = subtask.agent_kind ?? "hermes";
    const adapter = getAdapter(kind);
    if (!adapter) {
      await this.fail(run.id, goal, `no adapter registered for kind '${kind}'`);
      return;
    }

    // Pick (or null) an active agent of this kind for the audit trail.
    // Both the lookup and the subsequent agent_id stamp run inside the
    // goal's org scope so they stay correct under strict RLS.
    await withOrgScope(goal.org_id, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM ops.agent
         WHERE org_id = $1 AND kind = $2 AND is_active = true
         ORDER BY created_at LIMIT 1`,
        [goal.org_id, kind],
      );
      const found = rows[0]?.id ?? null;
      if (found !== null) {
        await client.query("UPDATE ops.run SET agent_id = $2 WHERE id = $1", [run.id, found]);
      }
    });

    const scope: Scope = {
      org_id: goal.org_id,
      department_id: goal.department_id,
      goal_id: goal.id,
      role: "agent",
    };

    try {
      await adapter.startRun({
        goal_id: goal.id,
        run_id: run.id,
        input: { subtask },
        scope,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(err, `dispatch to ${kind} failed`);
      await this.fail(run.id, goal, `dispatch to ${kind} failed: ${message}`);
      return;
    }

    log.info(`dispatched run ${run.id} to ${kind}`);
    this.inFlight.set(run.id, adapter);
    void this.pollUntilTerminal(run.id, goal, kind, adapter, log);
  }

  /** Long-lived poll that mirrors adapter state into ops.run. */
  private async pollUntilTerminal(
    runId: string,
    goal: { id: string; org_id: string; department_id: string | null },
    kind: string,
    adapter: AdapterClient,
    log: Logger,
  ): Promise<void> {
    const startedAt = Date.now();
    const POLL_MS = 750;
    const HARD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    try {
      while (this.running && Date.now() - startedAt < HARD_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));

        // Has paperclip-side cancel happened?
        const localRows = await withOrgScope(goal.org_id, async (client) => {
          const { rows } = await client.query<{ status: string }>(
            "SELECT status FROM ops.run WHERE id = $1",
            [runId],
          );
          return rows;
        });
        const local = localRows[0]?.status;
        if (local === "cancelled") {
          await adapter.cancel(runId);
          break;
        }

        let state;
        try {
          state = await adapter.getRun(runId);
        } catch (err) {
          log.error(err, `poll ${runId} on ${kind} failed`);
          continue;
        }

        if (state.status === "succeeded") {
          await this.succeed(runId, goal, state.output ?? {});
          break;
        }
        if (state.status === "failed") {
          await this.fail(runId, goal, state.error ?? "agent reported failure");
          break;
        }
        if (state.status === "cancelled") {
          await this.cancelLocal(runId, goal);
          break;
        }
      }
      if (Date.now() - startedAt >= HARD_TIMEOUT_MS) {
        await adapter.cancel(runId);
        await this.fail(runId, goal, "run exceeded hard timeout");
      }
    } finally {
      this.inFlight.delete(runId);
    }
  }

  private async succeed(
    runId: string,
    goal: { id: string; org_id: string; department_id: string | null },
    output: Record<string, unknown>,
  ): Promise<void> {
    await withOrgScope(goal.org_id, async (client) => {
      await client.query(
        `UPDATE ops.run
         SET status = 'succeeded', output = $2::jsonb, finished_at = now()
         WHERE id = $1`,
        [runId, JSON.stringify(output)],
      );
      await audit(
        {
          scope: scopeFor(goal),
          action: "run.succeeded",
          target_type: "run",
          target_id: runId,
          metadata: { goal_id: goal.id, ...(output.memory_id ? { memory_id: output.memory_id } : {}) },
        },
        client,
      );
    });
  }

  private async fail(
    runId: string,
    goal: { id: string; org_id: string; department_id: string | null },
    error: string,
  ): Promise<void> {
    await withOrgScope(goal.org_id, async (client) => {
      await client.query(
        `UPDATE ops.run
         SET status = 'failed', error = $2, finished_at = now()
         WHERE id = $1`,
        [runId, error],
      );
      await audit(
        {
          scope: scopeFor(goal),
          action: "run.failed",
          target_type: "run",
          target_id: runId,
          metadata: { goal_id: goal.id, error },
        },
        client,
      );
    });
  }

  private async cancelLocal(
    runId: string,
    goal: { id: string; org_id: string; department_id: string | null },
  ): Promise<void> {
    await withOrgScope(goal.org_id, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE ops.run
         SET status = 'cancelled', finished_at = now()
         WHERE id = $1 AND status NOT IN ('succeeded','failed','cancelled')`,
        [runId],
      );
      if ((rowCount ?? 0) > 0) {
        await audit(
          {
            scope: scopeFor(goal),
            action: "run.cancelled",
            target_type: "run",
            target_id: runId,
            metadata: { goal_id: goal.id },
          },
          client,
        );
      }
    });
  }
}

type SubtaskShape = {
  index: number;
  title: string;
  description: string;
  input: Record<string, unknown>;
  agent_kind?: string;
};

function scopeFor(goal: { org_id: string; department_id: string | null; id: string }): Scope {
  return {
    org_id: goal.org_id,
    department_id: goal.department_id,
    goal_id: goal.id,
    role: "agent",
  };
}

export const worker = new Worker();
