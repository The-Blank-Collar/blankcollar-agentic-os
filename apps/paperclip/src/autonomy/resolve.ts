/**
 * Autonomy mode resolver — walks the scope hierarchy to find the active
 * mode for a given (org, department, agent, skill) request context.
 *
 * Resolution order (most specific wins):
 *   1. ops.autonomy_mode where scope_kind='skill'      AND scope_id = skill_id
 *   2. ops.autonomy_mode where scope_kind='agent'      AND scope_id = agent_id
 *   3. ops.autonomy_mode where scope_kind='department' AND scope_id = department_id
 *   4. ops.autonomy_mode where scope_kind='org'        AND org_id   = org_id
 *   5. default → 'custom' (delegate to ops.policy unchanged)
 *
 * The `spending_cap_cents` field rides along with whatever mode wins — at
 * the call-site, the cap is consulted for `auto_approve` to decide whether
 * to escalate to `approve`. Higher-precedence rows' caps shadow lower ones.
 *
 * Must run inside a `withOrgScope()` (or `withSystemScope()`) transaction.
 */

import type pg from "pg";

import type { AutonomyMode, AutonomyScopeKind } from "../schemas.js";

export type AutonomyContext = {
  orgId: string;
  departmentId?: string | null;
  agentId?: string | null;
  skillId?: string | null;
};

export type ResolvedAutonomy = {
  mode: AutonomyMode;
  spending_cap_cents: number | null;
  /** The scope row that won; `null` when defaulting to `custom`. */
  source: {
    scope_kind: AutonomyScopeKind;
    scope_id: string | null;
    notes: string | null;
  } | null;
};

type AutonomyRow = {
  id: string;
  scope_kind: AutonomyScopeKind;
  scope_id: string | null;
  mode: AutonomyMode;
  spending_cap_cents: number | null;
  notes: string | null;
};

const PRIORITY: AutonomyScopeKind[] = ["skill", "agent", "department", "org"];

export async function resolveAutonomy(
  client: pg.PoolClient,
  ctx: AutonomyContext,
): Promise<ResolvedAutonomy> {
  // Pull every row that COULD apply in one query — typically O(1)–O(4) rows
  // per org. Then pick the most specific match in JS.
  const conditions: string[] = ["org_id = $1"];
  const params: unknown[] = [ctx.orgId];

  const orParts: string[] = ["scope_kind = 'org'"];
  if (ctx.departmentId) {
    params.push(ctx.departmentId);
    orParts.push(`(scope_kind = 'department' AND scope_id = $${params.length})`);
  }
  if (ctx.agentId) {
    params.push(ctx.agentId);
    orParts.push(`(scope_kind = 'agent' AND scope_id = $${params.length})`);
  }
  if (ctx.skillId) {
    params.push(ctx.skillId);
    orParts.push(`(scope_kind = 'skill' AND scope_id = $${params.length})`);
  }
  conditions.push(`(${orParts.join(" OR ")})`);

  const { rows } = await client.query<AutonomyRow>(
    `SELECT id, scope_kind, scope_id, mode, spending_cap_cents, notes
       FROM ops.autonomy_mode
      WHERE ${conditions.join(" AND ")}`,
    params,
  );

  if (rows.length === 0) {
    return { mode: "custom", spending_cap_cents: null, source: null };
  }

  for (const kind of PRIORITY) {
    const winner = rows.find((r) => r.scope_kind === kind);
    if (winner) {
      return {
        mode: winner.mode,
        spending_cap_cents: winner.spending_cap_cents,
        source: {
          scope_kind: winner.scope_kind,
          scope_id: winner.scope_id,
          notes: winner.notes,
        },
      };
    }
  }
  return { mode: "custom", spending_cap_cents: null, source: null };
}
