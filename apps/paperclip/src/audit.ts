/**
 * Single helper to write to core.audit_log. Every mutation should call this.
 *
 * Two call shapes:
 *   - audit(entry, client) — already inside a withOrgScope tx; reuses
 *     the caller's pg.PoolClient so the audit row lands in the same
 *     transaction as the action it audits.
 *   - audit(entry)         — convenience for callers outside a tx;
 *     the helper opens its own withOrgScope(entry.scope.org_id) on the
 *     pool. Required after the Phase-2.6 RLS strict flip — a bare
 *     query() into core.audit_log returns 0 rows under strict mode.
 */

import type pg from "pg";

import { withOrgScope, withSystemScope } from "./db.js";
import type { Scope } from "./schemas.js";

export type AuditEntry = {
  scope: Scope;
  action: string;
  target_type: string;
  target_id: string;
  metadata?: Record<string, unknown>;
};

const AUDIT_SQL = `
  INSERT INTO core.audit_log
    (org_id, actor_role, action, target_type, target_id, metadata)
  VALUES ($1, $2::core.role_kind, $3, $4, $5, $6::jsonb)
`;

export async function audit(
  entry: AuditEntry,
  client?: pg.PoolClient,
): Promise<void> {
  const params = [
    entry.scope.org_id,
    entry.scope.role,
    entry.action,
    entry.target_type,
    entry.target_id,
    JSON.stringify(entry.metadata ?? {}),
  ];
  if (client) {
    await client.query(AUDIT_SQL, params);
    return;
  }
  // No caller transaction → open our own, scoped to the entry's org.
  // Falls back to system scope when the entry has no org context (rare —
  // mostly bootstrap / system tasks before any tenant exists).
  if (entry.scope.org_id) {
    await withOrgScope(entry.scope.org_id, async (c) => {
      await c.query(AUDIT_SQL, params);
    });
  } else {
    await withSystemScope(async (c) => {
      await c.query(AUDIT_SQL, params);
    });
  }
}
