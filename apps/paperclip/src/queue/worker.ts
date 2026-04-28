/**
 * Tiny in-process queue worker. Polls ops.run for `queued` rows, atomically
 * claims one with FOR UPDATE SKIP LOCKED, dispatches it to the fake agent,
 * and updates status. Single-instance for now; scale-out is a Phase 3 concern.
 */

import { config } from "../config.js";
import { audit } from "../audit.js";
import { tx, query } from "../db.js";
import type { Scope } from "../schemas.js";
import { runFakeAgent } from "./fake-agent.js";

export class Worker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private busy = false;

  start(log: { info: (msg: string) => void; error: (err: unknown, msg: string) => void }): void {
    if (this.running) return;
    this.running = true;
    log.info(`paperclip worker started (poll=${config.workerPollIntervalMs}ms)`);
    const tick = async (): Promise<void> => {
      if (!this.running) return;
      if (!this.busy) {
        this.busy = true;
        try {
          await this.processOne();
        } catch (err) {
          log.error(err, "worker tick failed");
        } finally {
          this.busy = false;
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
    // Wait briefly so an in-flight tick can finish.
    for (let i = 0; i < 20 && this.busy; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async processOne(): Promise<void> {
    type ClaimedRun = {
      id: string;
      goal_id: string;
      input: Record<string, unknown>;
    };
    type ClaimedGoal = {
      id: string;
      org_id: string;
      department_id: string | null;
    };

    const claimed = await tx(async (client) => {
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
        await client.query("UPDATE ops.run SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [
          run.id,
          "goal not found",
        ]);
        return undefined;
      }
      return { run, goal: goalRows[0]! };
    });

    if (!claimed) return;

    const { run, goal } = claimed;

    const scope: Scope = {
      org_id: goal.org_id,
      department_id: goal.department_id,
      goal_id: goal.id,
      role: "agent",
    };

    const subtask = (run.input as { subtask?: unknown }).subtask as
      | { index: number; title: string; description: string; input: Record<string, unknown> }
      | undefined;

    if (!subtask) {
      await query(
        "UPDATE ops.run SET status = 'failed', error = $2, finished_at = now() WHERE id = $1",
        [run.id, "missing subtask in input"],
      );
      return;
    }

    try {
      const result = await runFakeAgent({
        scope,
        goal_id: goal.id,
        run_id: run.id,
        subtask,
      });

      await tx(async (client) => {
        await client.query(
          `UPDATE ops.run
           SET status = 'succeeded', output = $2::jsonb, finished_at = now()
           WHERE id = $1`,
          [run.id, JSON.stringify(result.output)],
        );
        await audit(
          {
            scope: { ...scope, role: "agent" },
            action: "run.succeeded",
            target_type: "run",
            target_id: run.id,
            metadata: { goal_id: goal.id, ...(result.memory_id ? { memory_id: result.memory_id } : {}) },
          },
          client,
        );
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await tx(async (client) => {
        await client.query(
          `UPDATE ops.run
           SET status = 'failed', error = $2, finished_at = now()
           WHERE id = $1`,
          [run.id, message],
        );
        await audit(
          {
            scope: { ...scope, role: "agent" },
            action: "run.failed",
            target_type: "run",
            target_id: run.id,
            metadata: { goal_id: goal.id, error: message },
          },
          client,
        );
      });
    }
  }
}

export const worker = new Worker();
