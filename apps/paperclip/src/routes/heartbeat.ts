/**
 * Heartbeat — 14-day system pulse.
 *
 * Powers the design's Heartbeat rail and Goal Detail timeline. v0 reports
 * what we actually have data for: captures, runs completed, active goals,
 * activity volume. Real business KPIs (ARR, pipeline, margin) come later
 * when Stripe/CRM data lands.
 *
 * The series are date-aligned so the frontend can chart them directly
 * without re-aligning. Date strings are ISO yyyy-mm-dd in UTC.
 */

import type { FastifyInstance } from "fastify";

import { query } from "../db.js";
import { resolveCallerScope } from "../scope.js";

export type HeartbeatPoint = { date: string; value: number };

export type HeartbeatSeries = {
  kpi: string;
  label: string;
  unit: string;
  points: HeartbeatPoint[];
};

export type HeartbeatResponse = {
  period_days: number;
  period_start: string;
  period_end: string;
  series: HeartbeatSeries[];
};

const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;

function alignedDates(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function rollup(rows: { day: string; ct: string }[], dates: string[]): HeartbeatPoint[] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.day, Number(r.ct));
  return dates.map((date) => ({ date, value: map.get(date) ?? 0 }));
}

export async function heartbeatRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { days?: string } }>("/api/heartbeat", async (req) => {
    const scope = await resolveCallerScope(req);
    const days = Math.min(Math.max(Number(req.query.days ?? DEFAULT_DAYS), 1), MAX_DAYS);
    const dates = alignedDates(days);
    const periodStart = `${dates[0]!}T00:00:00Z`;
    const periodEnd = new Date().toISOString();

    const [captures, runs, goals, audits] = await Promise.all([
      query<{ day: string; ct: string }>(
        `SELECT to_char(date_trunc('day', created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                count(*)::text AS ct
           FROM ops.capture
          WHERE org_id = $1 AND created_at >= $2
          GROUP BY 1`,
        [scope.org_id, periodStart],
      ),
      query<{ day: string; ct: string }>(
        `SELECT to_char(date_trunc('day', r.finished_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                count(*)::text AS ct
           FROM ops.run r
           JOIN ops.goal g ON g.id = r.goal_id
          WHERE g.org_id = $1
            AND r.status = 'succeeded'
            AND r.finished_at >= $2
          GROUP BY 1`,
        [scope.org_id, periodStart],
      ),
      query<{ day: string; ct: string }>(
        // "active goals on day X" is counted as goals created on X that are
        // still active or were active during X. Cheap proxy for v0: count
        // active-status goals whose updated_at falls on day X.
        `SELECT to_char(date_trunc('day', updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                count(DISTINCT id)::text AS ct
           FROM ops.goal
          WHERE org_id = $1
            AND status = 'active'
            AND updated_at >= $2
          GROUP BY 1`,
        [scope.org_id, periodStart],
      ),
      query<{ day: string; ct: string }>(
        `SELECT to_char(date_trunc('day', created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                count(*)::text AS ct
           FROM core.audit_log
          WHERE org_id = $1 AND created_at >= $2
          GROUP BY 1`,
        [scope.org_id, periodStart],
      ),
    ]);

    const response: HeartbeatResponse = {
      period_days: days,
      period_start: periodStart,
      period_end: periodEnd,
      series: [
        { kpi: "captures",       label: "Captures",       unit: "count",  points: rollup(captures.rows, dates) },
        { kpi: "runs_completed", label: "Runs completed", unit: "count",  points: rollup(runs.rows,     dates) },
        { kpi: "goals_active",   label: "Goals in flight", unit: "count", points: rollup(goals.rows,    dates) },
        { kpi: "activity",       label: "Activity",       unit: "events", points: rollup(audits.rows,   dates) },
      ],
    };
    return response;
  });
}
