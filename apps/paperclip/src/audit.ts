/** Single helper to write to core.audit_log. Every mutation should call this. */

import type pg from "pg";

import { query } from "./db.js";
import type { Scope } from "./schemas.js";

export type AuditEntry = {
  scope: Scope;
  action: string;
  target_type: string;
  target_id: string;
  metadata?: Record<string, unknown>;
};

export async function audit(
  entry: AuditEntry,
  client?: pg.PoolClient,
): Promise<void> {
  const sql = `
    INSERT INTO core.audit_log
      (org_id, actor_role, action, target_type, target_id, metadata)
    VALUES ($1, $2::core.role_kind, $3, $4, $5, $6::jsonb)
  `;
  const params = [
    entry.scope.org_id,
    entry.scope.role,
    entry.action,
    entry.target_type,
    entry.target_id,
    JSON.stringify(entry.metadata ?? {}),
  ];
  if (client) {
    await client.query(sql, params);
  } else {
    await query(sql, params);
  }
}
