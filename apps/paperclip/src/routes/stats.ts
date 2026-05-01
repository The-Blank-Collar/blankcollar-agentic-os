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

export type GoalsSummary = {
  total: number;
  by_kind: { ephemeral: number; standing: number; routine: number; decision: number };
  by_status: {
    draft: number;
    active: number;
    paused: number;
    achieved: number;
    abandoned: number;
  };
  stalled_count: number;
};

export type AgentStats = {
  agent_id: string;
  runs_total: number;
  runs_succeeded: number;
  runs_failed: number;
  runs_running: number;
  success_rate: number | null;
  avg_duration_ms: number | null;
  last_run_at: string | null;
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

const STALLED_DEFAULT_DAYS = 7;

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  // -- goals summary (org-wide rollup) ------------------------------------
  // One row of integers for the dashboard headline strip — counts per
  // kind, per status, and "what's stuck" stalled-count. Single trip.
  app.get<{ Querystring: { stalled_days?: string } }>("/api/goals/summary", async (req) => {
    const scope = await resolveCallerScope(req);
    const stalledDays = Math.min(
      Math.max(Number(req.query.stalled_days ?? STALLED_DEFAULT_DAYS), 1),
      365,
    );
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<{
        total: string;
        ephemeral: string;
        standing: string;
        routine: string;
        decision: string;
        draft: string;
        active: string;
        paused: string;
        achieved: string;
        abandoned: string;
      }>(
        `SELECT
            COUNT(*)::text                                         AS total,
            COUNT(*) FILTER (WHERE kind = 'ephemeral')::text       AS ephemeral,
            COUNT(*) FILTER (WHERE kind = 'standing')::text        AS standing,
            COUNT(*) FILTER (WHERE kind = 'routine')::text         AS routine,
            COUNT(*) FILTER (WHERE kind = 'decision')::text        AS decision,
            COUNT(*) FILTER (WHERE status = 'draft')::text         AS draft,
            COUNT(*) FILTER (WHERE status = 'active')::text        AS active,
            COUNT(*) FILTER (WHERE status = 'paused')::text        AS paused,
            COUNT(*) FILTER (WHERE status = 'achieved')::text      AS achieved,
            COUNT(*) FILTER (WHERE status = 'abandoned')::text     AS abandoned
           FROM ops.goal
          WHERE org_id = $1`,
        [scope.org_id],
      );
      const { rows: stalledRows } = await client.query<{ stalled: string }>(
        `SELECT COUNT(*)::text AS stalled
           FROM ops.goal g
          WHERE g.org_id = $1
            AND g.status IN ('active','draft')
            AND COALESCE(
                  (SELECT MAX(r.created_at) FROM ops.run r WHERE r.goal_id = g.id),
                  g.created_at
                ) < now() - ($2 || ' days')::interval`,
        [scope.org_id, stalledDays],
      );

      const r = rows[0]!;
      const out: GoalsSummary = {
        total: Number(r.total ?? "0"),
        by_kind: {
          ephemeral: Number(r.ephemeral ?? "0"),
          standing: Number(r.standing ?? "0"),
          routine: Number(r.routine ?? "0"),
          decision: Number(r.decision ?? "0"),
        },
        by_status: {
          draft: Number(r.draft ?? "0"),
          active: Number(r.active ?? "0"),
          paused: Number(r.paused ?? "0"),
          achieved: Number(r.achieved ?? "0"),
          abandoned: Number(r.abandoned ?? "0"),
        },
        stalled_count: Number(stalledRows[0]?.stalled ?? "0"),
      };
      return out;
    });
  });

  // -- per-agent stats ----------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/agents/:id/stats", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const stats = await withOrgScope(scope.org_id, async (client) => {
      const { rows: own } = await client.query<{ id: string }>(
        "SELECT id FROM ops.agent WHERE id = $1 AND org_id = $2",
        [req.params.id, scope.org_id],
      );
      if (own.length === 0) return null;
      const { rows } = await client.query<{
        runs_total: string;
        runs_succeeded: string;
        runs_failed: string;
        runs_running: string;
        avg_duration_ms: string | null;
        last_run_at: string | null;
      }>(
        `SELECT
            COUNT(*)::text                                           AS runs_total,
            COUNT(*) FILTER (WHERE r.status = 'succeeded')::text     AS runs_succeeded,
            COUNT(*) FILTER (WHERE r.status = 'failed')::text        AS runs_failed,
            COUNT(*) FILTER (WHERE r.status = 'running')::text       AS runs_running,
            AVG(EXTRACT(EPOCH FROM (r.finished_at - r.started_at)) * 1000)
                FILTER (WHERE r.finished_at IS NOT NULL AND r.started_at IS NOT NULL)::text
                                                                     AS avg_duration_ms,
            MAX(r.created_at)                                        AS last_run_at
           FROM ops.run r
           JOIN ops.goal g ON g.id = r.goal_id
          WHERE r.agent_id = $1 AND g.org_id = $2`,
        [req.params.id, scope.org_id],
      );
      const row = rows[0]!;
      const total = Number(row.runs_total ?? "0");
      const succeeded = Number(row.runs_succeeded ?? "0");
      const failed = Number(row.runs_failed ?? "0");
      const terminal = succeeded + failed;
      const result: AgentStats = {
        agent_id: req.params.id,
        runs_total: total,
        runs_succeeded: succeeded,
        runs_failed: failed,
        runs_running: Number(row.runs_running ?? "0"),
        success_rate: terminal > 0 ? Math.round((succeeded / terminal) * 1000) / 10 : null,
        avg_duration_ms: row.avg_duration_ms ? Math.round(Number(row.avg_duration_ms)) : null,
        last_run_at: row.last_run_at,
      };
      return result;
    });
    if (!stats) return reply.code(404).send({ error: "not_found" });
    return stats;
  });

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
