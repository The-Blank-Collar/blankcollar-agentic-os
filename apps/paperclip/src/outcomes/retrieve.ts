/**
 * Outcome retriever — given a context (skill_slug or agent_kind), pull
 * top-N successful past outcomes for few-shot injection.
 *
 * Strategy (intentionally simple for v1):
 *   1. SQL filter to the org + matching skill_slug or agent_kind.
 *   2. Sort by created_at DESC, take the most recent K candidates
 *      (default K=20). Recency keeps the few-shot relevant when domain
 *      drifts; older successful outputs may no longer reflect today's
 *      context.
 *   3. Join feedback + metrics in two follow-up queries, score with
 *      `scoreOutcomes`, return top-N by score (default N=3).
 *
 * Future v2 additions (deferred):
 *   - Embedding-based similarity over title + content_md (gbrain).
 *   - Per-metric weighting policy (some metrics matter more for
 *     specific output_kinds).
 *   - Recency decay multiplier on the score.
 *
 * Must run inside a `withOrgScope()` (or `withSystemScope()`) transaction.
 */

import type pg from "pg";

import { scoreOutcomes, type OutcomeForScoring, type ScoredOutcome } from "./score.js";

export type RetrieveQuery = {
  orgId: string;
  /** At least one of skill_slug or agent_kind must be provided. */
  skillSlug?: string | null;
  agentKind?: string | null;
  /** Output kind filter (e.g. 'campaign_copy', 'proposal'). Optional. */
  outputKind?: string | null;
  /** Top-N to return. Default 3. */
  topN?: number;
  /** Pool size from which to score. Default 20. */
  poolSize?: number;
};

export type RetrievedOutcome = ScoredOutcome & {
  title: string;
  content_md: string;
  output_kind: string;
  created_at: string;
};

export async function retrieveOutcomes(
  client: pg.PoolClient,
  q: RetrieveQuery,
): Promise<RetrievedOutcome[]> {
  if (!q.skillSlug && !q.agentKind) return [];

  const topN = q.topN ?? 3;
  const poolSize = q.poolSize ?? 20;

  const where: string[] = ["org_id = $1"];
  const params: unknown[] = [q.orgId];
  if (q.skillSlug) {
    params.push(q.skillSlug);
    where.push(`skill_slug = $${params.length}`);
  }
  if (q.agentKind) {
    params.push(q.agentKind);
    where.push(`agent_kind = $${params.length}`);
  }
  if (q.outputKind) {
    params.push(q.outputKind);
    where.push(`output_kind = $${params.length}`);
  }
  params.push(poolSize);

  const { rows: pool } = await client.query<{
    id: string;
    title: string;
    content_md: string;
    output_kind: string;
    created_at: string;
    run_id: string | null;
  }>(
    `SELECT id, title, content_md, output_kind, created_at, run_id
       FROM ops.outcome
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  if (pool.length === 0) return [];

  const ids = pool.map((p) => p.id);
  const runIds = pool.map((p) => p.run_id).filter((r): r is string => !!r);

  const { rows: metrics } = await client.query<{
    outcome_id: string;
    name: string;
    value: string;
    direction: "higher_is_better" | "lower_is_better" | "informational";
  }>(
    `SELECT outcome_id, name, value::text, direction
       FROM ops.outcome_metric
      WHERE outcome_id = ANY($1::uuid[])`,
    [ids],
  );

  const { rows: feedbacks } = runIds.length > 0
    ? await client.query<{ run_id: string; rating: number }>(
        `SELECT run_id, rating FROM ops.run_feedback
          WHERE run_id = ANY($1::uuid[])`,
        [runIds],
      )
    : { rows: [] as { run_id: string; rating: number }[] };

  // Group metrics by outcome_id, feedbacks by run_id.
  const metricsByOutcome = new Map<string, typeof metrics>();
  for (const m of metrics) {
    const arr = metricsByOutcome.get(m.outcome_id) ?? [];
    arr.push(m);
    metricsByOutcome.set(m.outcome_id, arr);
  }
  const feedbacksByRun = new Map<string, { rating: number }[]>();
  for (const f of feedbacks) {
    const arr = feedbacksByRun.get(f.run_id) ?? [];
    arr.push({ rating: f.rating });
    feedbacksByRun.set(f.run_id, arr);
  }

  const candidates: OutcomeForScoring[] = pool.map((p) => ({
    outcome_id: p.id,
    feedbacks: p.run_id ? feedbacksByRun.get(p.run_id) ?? [] : [],
    metrics: (metricsByOutcome.get(p.id) ?? []).map((m) => ({
      name: m.name,
      value: Number(m.value),
      direction: m.direction,
    })),
  }));

  const scored = scoreOutcomes(candidates);
  const byId = new Map(scored.map((s) => [s.outcome_id, s]));

  return pool
    .map((p) => {
      const s = byId.get(p.id)!;
      return {
        outcome_id: p.id,
        score: s.score,
        has_feedback: s.has_feedback,
        metric_count: s.metric_count,
        title: p.title,
        content_md: p.content_md,
        output_kind: p.output_kind,
        created_at: p.created_at,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
