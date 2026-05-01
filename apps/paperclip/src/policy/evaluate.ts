/**
 * Policy engine — evaluates `(role, agent_kind, skill_slug, action_kind)`
 * against `ops.policy` rows and returns one of `allow | approve | deny`.
 *
 * Match algorithm:
 *   - A row matches when each of its non-null criteria equals the request,
 *     and null criteria act as wildcards.
 *   - Multiple matching rows are ranked by:
 *       1. priority ASC (lower number = stronger)
 *       2. specificity DESC (fewer wildcards = stronger)
 *       3. created_at DESC (newer rule wins ties)
 *   - No match → `{ effect: "allow", matched: null }` (default-allow). For
 *     deny-by-default postures, callers add a wildcard `deny` row.
 *
 * The evaluator runs against an already-scoped `pg.PoolClient`, so it must
 * be called inside a `withOrgScope` (or `withSystemScope`) transaction.
 */

import type pg from "pg";

export type PolicyEffect = "allow" | "approve" | "deny";

export type PolicyRow = {
  id: string;
  org_id: string;
  role: string | null;
  agent_kind: string | null;
  skill_slug: string | null;
  action_kind: string | null;
  effect: PolicyEffect;
  priority: number;
  reason: string | null;
  created_at: string;
};

export type EvaluateContext = {
  orgId: string;
  role: string;
  agentKind?: string | null;
  skillSlug?: string | null;
  actionKind?: string | null;
};

export type EvaluateResult = {
  effect: PolicyEffect;
  matched: PolicyRow | null;
};

export async function evaluatePolicy(
  client: pg.PoolClient,
  ctx: EvaluateContext,
): Promise<EvaluateResult> {
  // SQL filter: each criterion either matches the request or is null.
  // We include NULL-as-wildcard rows in the result; ranking happens in JS
  // because Postgres can't easily rank by "fewer NULLs" without a CASE
  // sum, and the result set is tiny (one org's policies).
  const { rows } = await client.query<PolicyRow>(
    `SELECT id, org_id, role, agent_kind, skill_slug, action_kind,
            effect, priority, reason, created_at
       FROM ops.policy
      WHERE org_id = $1
        AND (role         IS NULL OR role        = $2::core.role_kind)
        AND (agent_kind   IS NULL OR agent_kind  = $3)
        AND (skill_slug   IS NULL OR skill_slug  = $4)
        AND (action_kind  IS NULL OR action_kind = $5)`,
    [
      ctx.orgId,
      ctx.role,
      ctx.agentKind ?? null,
      ctx.skillSlug ?? null,
      ctx.actionKind ?? null,
    ],
  );

  if (rows.length === 0) {
    return { effect: "allow", matched: null };
  }

  rows.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aWild = wildcards(a);
    const bWild = wildcards(b);
    if (aWild !== bWild) return aWild - bWild;
    return a.created_at < b.created_at ? 1 : -1;
  });

  const winner = rows[0]!;
  return { effect: winner.effect, matched: winner };
}

function wildcards(p: PolicyRow): number {
  let n = 0;
  if (p.role === null) n++;
  if (p.agent_kind === null) n++;
  if (p.skill_slug === null) n++;
  if (p.action_kind === null) n++;
  return n;
}
