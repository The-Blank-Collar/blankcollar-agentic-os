/**
 * Self-improvement API.
 *
 *   POST /api/self/audit                 run a self-audit now (synchronous, ~1s)
 *   POST /api/self/level-up              propose changes from latest audit
 *   GET  /api/self/reports               recent audit / level-up reports
 *   POST /api/self/reports/:id/apply     mark a report's suggestions as applied
 *
 * Audit + Level-Up are normally fired weekly by the scheduler via routine
 * goals that POST to these endpoints. The endpoints work standalone so the
 * UI / operators can trigger them ad-hoc too.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import { AuditReportRunRequest } from "../schemas.js";
import {
  composeAudit,
  composeLevelUp,
  persistReport,
} from "../skills/self_improvement.js";

type ReportRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  kind: "audit" | "level_up";
  period_start: string;
  period_end: string;
  summary_md: string;
  findings: unknown;
  suggestions: unknown;
  applied: boolean;
  created_at: string;
};

const REPORT_COLUMNS = "id, org_id, user_id, kind, period_start, period_end, summary_md, findings, suggestions, applied, created_at";

export async function selfImprovementRoutes(app: FastifyInstance): Promise<void> {
  // -- run an audit now ---------------------------------------------------
  app.post("/api/self/audit", async (req, reply) => {
    const parsed = AuditReportRunRequest.safeParse({ ...(req.body as object), kind: "audit" });
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const report = await composeAudit(scope.org_id, parsed.data.period_hours, parsed.data.user_id);
    const persisted = await persistReport(scope, report, parsed.data.user_id);
    return reply.code(201).send({ id: persisted.id, ...report });
  });

  // -- propose level-up suggestions ---------------------------------------
  app.post<{ Body?: { audit_report_id?: string } }>("/api/self/level-up", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const report = await composeLevelUp(scope.org_id, req.body?.audit_report_id);
    const persisted = await persistReport(scope, report);
    return reply.code(201).send({ id: persisted.id, ...report });
  });

  // -- list reports -------------------------------------------------------
  app.get<{ Querystring: { kind?: "audit" | "level_up"; limit?: string } }>(
    "/api/self/reports",
    async (req) => {
      const scope = await resolveCallerScope(req);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
      const params: unknown[] = [scope.org_id];
      const where = ["org_id = $1"];
      if (req.query.kind === "audit" || req.query.kind === "level_up") {
        params.push(req.query.kind);
        where.push(`kind = $${params.length}::ops.audit_report_kind`);
      }
      params.push(limit);
      return withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<ReportRow>(
          `SELECT ${REPORT_COLUMNS} FROM ops.audit_report
            WHERE ${where.join(" AND ")}
            ORDER BY created_at DESC LIMIT $${params.length}`,
          params,
        );
        return rows;
      });
    },
  );

  // -- mark suggestions applied -------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/api/self/reports/:id/apply",
    async (req, reply) => {
      const scope = await resolveCallerScope(req);
      const result = await withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<ReportRow>(
          `UPDATE ops.audit_report
              SET applied = true
            WHERE id = $1 AND org_id = $2
            RETURNING ${REPORT_COLUMNS}`,
          [req.params.id, scope.org_id],
        );
        if (rows.length === 0) return undefined;
        await audit(
          {
            scope,
            action: "self.report.apply",
            target_type: "audit_report",
            target_id: rows[0]!.id,
          },
          client,
        );
        return rows[0]!;
      });
      if (!result) return reply.code(404).send({ error: "not_found" });
      return result;
    },
  );
}
