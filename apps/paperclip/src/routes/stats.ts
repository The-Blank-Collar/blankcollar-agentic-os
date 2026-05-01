/**
 * Stats + activity endpoints.
 *
 *   GET /api/goals/:id/stats          per-goal run rollup
 *   GET /api/activity?limit=N         most recent runs across the whole org
 *
 * Both are derived views over `ops.run` — no new tables. They exist as
 * dedicated endpoints so the frontend (and CLI) doesn't have to download
 * the full run list to compute counts.
 */

import type { FastifyInstance } from "fastify";

import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";

export type GoalStats = {
  goal_id: string;
  runs_total: number;
  runs_succeeded: number;
  runs_failed: number;
  runs_running: number;
  runs_queued: number;
  avg_duration_ms: number | null;
  last_run_at: string | null;
  last_run_status: string | null;
};

export type ActivityRow = {
  run_id: string;
  goal_id: string;
  goal_title: string;
  goal_kind: string;
  agent_id: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  duration_ms: number | null;
  subtask_title: string | null;
};

const ACTIVITY_DEFAULT_LIMIT = 20;
const ACTIVITY_MAX_LIMIT = 100;

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  // -- per-goal stats -----------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/goals/:id/stats", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const stats = await withOrgScope(scope.org_id, async (client) => {
      // Verify the goal belongs to this org. Cheap; lets us 404 cleanly.
      const { rows: own } = await client.query<{ id: string }>(
        "SELECT id FROM ops.goal WHERE id = $1 AND org_id = $2",
        [req.params.id, scope.org_id],
      );
      if (own.length === 0) return null;

      const { rows } = await client.query<{
        runs_total: string;
        runs_succeeded: string;
        runs_failed: string;
        runs_running: string;
        runs_queued: string;
        avg_duration_ms: string | null;
        last_run_at: string | null;
        last_run_status: string | null;
      }>(
        `SELECT
            COUNT(*)::text                                              AS runs_total,
            COUNT(*) FILTER (WHERE status = 'succeeded')::text          AS runs_succeeded,
            COUNT(*) FILTER (WHERE status = 'failed')::text             AS runs_failed,
            COUNT(*) FILTER (WHERE status = 'running')::text            AS runs_running,
            COUNT(*) FILTER (WHERE status = 'queued')::text             AS runs_queued,
            AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)
                FILTER (WHERE finished_at IS NOT NULL AND started_at IS NOT NULL)::text
                                                                        AS avg_duration_ms,
            MAX(created_at)                                             AS last_run_at,
            (SELECT status FROM ops.run WHERE goal_id = $1
                ORDER BY created_at DESC LIMIT 1)                       AS last_run_status
           FROM ops.run
          WHERE goal_id = $1`,
        [req.params.id],
      );

      const row = rows[0]!;
      const result: GoalStats = {
        goal_id: req.params.id,
        runs_total: Number(row.runs_total ?? "0"),
        runs_succeeded: Number(row.runs_succeeded ?? "0"),
        runs_failed: Number(row.runs_failed ?? "0"),
        runs_running: Number(row.runs_running ?? "0"),
        runs_queued: Number(row.runs_queued ?? "0"),
        avg_duration_ms: row.avg_duration_ms ? Math.round(Number(row.avg_duration_ms)) : null,
        last_run_at: row.last_run_at,
        last_run_status: row.last_run_status,
      };
      return result;
    });
    if (!stats) return reply.code(404).send({ error: "not_found" });
    return stats;
  });

  // -- recent activity (org-wide) -----------------------------------------
  app.get<{ Querystring: { limit?: string } }>("/api/activity", async (req) => {
    const scope = await resolveCallerScope(req);
    const limit = Math.min(
      Math.max(Number(req.query.limit ?? ACTIVITY_DEFAULT_LIMIT), 1),
      ACTIVITY_MAX_LIMIT,
    );
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<{
        run_id: string;
        goal_id: string;
        goal_title: string;
        goal_kind: string;
        agent_id: string | null;
        status: string;
        started_at: string | null;
        finished_at: string | null;
        created_at: string;
        duration_ms: string | null;
        input: { subtask?: { title?: string } } | null;
      }>(
        `SELECT
             r.id            AS run_id,
             r.goal_id,
             g.title         AS goal_title,
             g.kind          AS goal_kind,
             r.agent_id,
             r.status,
             r.started_at,
             r.finished_at,
             r.created_at,
             CASE WHEN r.started_at IS NOT NULL AND r.finished_at IS NOT NULL
                  THEN (EXTRACT(EPOCH FROM (r.finished_at - r.started_at)) * 1000)::text
                  ELSE NULL
             END             AS duration_ms,
             r.input
           FROM ops.run r
           JOIN ops.goal g ON g.id = r.goal_id
          WHERE g.org_id = $1
          ORDER BY r.created_at DESC
          LIMIT $2`,
        [scope.org_id, limit],
      );
      const out: ActivityRow[] = rows.map((r) => ({
        run_id: r.run_id,
        goal_id: r.goal_id,
        goal_title: r.goal_title,
        goal_kind: r.goal_kind,
        agent_id: r.agent_id,
        status: r.status,
        started_at: r.started_at,
        finished_at: r.finished_at,
        created_at: r.created_at,
        duration_ms: r.duration_ms ? Math.round(Number(r.duration_ms)) : null,
        subtask_title: r.input?.subtask?.title ?? null,
      }));
      return out;
    });
  });
}
