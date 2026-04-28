import type { FastifyInstance } from "fastify";

import { query } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import { AuditQuery } from "../schemas.js";

type AuditRow = {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/audit", async (req, reply) => {
    const parsed = AuditQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope();
    const where: string[] = ["org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (parsed.data.action) {
      params.push(parsed.data.action);
      where.push(`action = $${params.length}`);
    }
    if (parsed.data.target_type) {
      params.push(parsed.data.target_type);
      where.push(`target_type = $${params.length}`);
    }
    params.push(parsed.data.limit);
    const sql = `
      SELECT id::text, actor_id, actor_role, action, target_type, target_id, metadata, created_at
      FROM core.audit_log
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `;
    const { rows } = await query<AuditRow>(sql, params);
    return rows;
  });
}
