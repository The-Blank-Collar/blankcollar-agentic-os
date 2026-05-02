/**
 * Read-only views over `ops.llm_call_log`.
 *
 *   GET /api/llm/calls?limit=50          recent LLM calls
 *   GET /api/llm/summary?hours=24        rolled-up totals (calls,
 *                                         tokens, latency, by model)
 *
 * Writes happen inside the gateway's `recordLlmCall()` helper. This file
 * is the read surface — `bc llm` and the future console use it.
 */

import type { FastifyInstance } from "fastify";

import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";

type CallRow = {
  id: string;
  org_id: string | null;
  run_id: string | null;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  status: string;
  error: string | null;
  portkey_trace_id: string | null;
  created_at: string;
};

const MAX_LIMIT = 200;

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  // -- list ---------------------------------------------------------------
  app.get<{ Querystring: { limit?: string; status?: string; provider?: string } }>(
    "/api/llm/calls",
    async (req) => {
      const scope = await resolveCallerScope(req);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), MAX_LIMIT);
      const where: string[] = ["org_id = $1"];
      const params: unknown[] = [scope.org_id];
      if (req.query.status) {
        params.push(req.query.status);
        where.push(`status = $${params.length}`);
      }
      if (req.query.provider) {
        params.push(req.query.provider);
        where.push(`provider = $${params.length}`);
      }
      params.push(limit);
      return withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<CallRow>(
          `SELECT id, org_id, run_id, provider, model, tokens_in, tokens_out,
                  latency_ms, status, error, portkey_trace_id, created_at
             FROM ops.llm_call_log
            WHERE ${where.join(" AND ")}
            ORDER BY created_at DESC
            LIMIT $${params.length}`,
          params,
        );
        return rows;
      });
    },
  );

  // -- summary ------------------------------------------------------------
  // Aggregates over a window. Caps at 30 days. Returns total call count,
  // total tokens, average latency, plus per-model + per-status breakdowns.
  app.get<{ Querystring: { hours?: string } }>("/api/llm/summary", async (req) => {
    const scope = await resolveCallerScope(req);
    const hours = Math.min(Math.max(Number(req.query.hours ?? 24), 1), 30 * 24);
    return withOrgScope(scope.org_id, async (client) => {
      const since = new Date(Date.now() - hours * 3_600_000).toISOString();

      const [totals, byModel, byStatus] = await Promise.all([
        client.query<{
          total: string;
          tokens_in: string;
          tokens_out: string;
          avg_latency_ms: string | null;
          errors: string;
        }>(
          `SELECT
              COUNT(*)::text                                              AS total,
              COALESCE(SUM(tokens_in),  0)::text                          AS tokens_in,
              COALESCE(SUM(tokens_out), 0)::text                          AS tokens_out,
              AVG(latency_ms)::text                                       AS avg_latency_ms,
              COUNT(*) FILTER (WHERE status = 'error')::text              AS errors
             FROM ops.llm_call_log
            WHERE org_id = $1 AND created_at >= $2`,
          [scope.org_id, since],
        ),
        client.query<{ model: string; count: string; tokens_in: string; tokens_out: string }>(
          `SELECT model,
                  COUNT(*)::text                AS count,
                  COALESCE(SUM(tokens_in),0)::text  AS tokens_in,
                  COALESCE(SUM(tokens_out),0)::text AS tokens_out
             FROM ops.llm_call_log
            WHERE org_id = $1 AND created_at >= $2
            GROUP BY model
            ORDER BY 2 DESC`,
          [scope.org_id, since],
        ),
        client.query<{ status: string; count: string }>(
          `SELECT status, COUNT(*)::text AS count
             FROM ops.llm_call_log
            WHERE org_id = $1 AND created_at >= $2
            GROUP BY status`,
          [scope.org_id, since],
        ),
      ]);

      const t = totals.rows[0]!;
      return {
        period_hours: hours,
        period_start: since,
        total: Number(t.total ?? "0"),
        tokens_in: Number(t.tokens_in ?? "0"),
        tokens_out: Number(t.tokens_out ?? "0"),
        avg_latency_ms: t.avg_latency_ms ? Math.round(Number(t.avg_latency_ms)) : null,
        errors: Number(t.errors ?? "0"),
        by_model: byModel.rows.map((r) => ({
          model: r.model,
          count: Number(r.count ?? "0"),
          tokens_in: Number(r.tokens_in ?? "0"),
          tokens_out: Number(r.tokens_out ?? "0"),
        })),
        by_status: byStatus.rows.map((r) => ({
          status: r.status,
          count: Number(r.count ?? "0"),
        })),
      };
    });
  });
}
