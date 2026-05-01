import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";

type RunRow = {
  id: string;
  goal_id: string;
  agent_id: string | null;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export async function runRoutes(app: FastifyInstance): Promise<void> {
  // -- list (by goal) -----------------------------------------------------
  app.get<{ Querystring: { goal_id?: string } }>("/api/runs", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const where: string[] = ["g.org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (req.query.goal_id) {
      params.push(req.query.goal_id);
      where.push(`r.goal_id = $${params.length}`);
    }
    const sql = `
      SELECT r.id, r.goal_id, r.agent_id, r.status, r.input, r.output, r.error,
             r.started_at, r.finished_at, r.created_at
      FROM ops.run r
      JOIN ops.goal g ON g.id = r.goal_id
      WHERE ${where.join(" AND ")}
      ORDER BY r.created_at DESC
      LIMIT 100
    `;
    const rows = await withOrgScope(scope.org_id, async (client) => {
      const { rows: rs } = await client.query<RunRow>(sql, params);
      return rs;
    });
    if (req.query.goal_id) return rows;
    return reply.send(rows);
  });

  // -- get ----------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/runs/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const rows = await withOrgScope(scope.org_id, async (client) => {
      const { rows: rs } = await client.query<RunRow>(
        `SELECT r.*
         FROM ops.run r
         JOIN ops.goal g ON g.id = r.goal_id
         WHERE r.id = $1 AND g.org_id = $2`,
        [req.params.id, scope.org_id],
      );
      return rs;
    });
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });

  // -- cancel -------------------------------------------------------------
  app.post<{ Params: { id: string } }>("/api/runs/:id/cancel", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<RunRow>(
        `UPDATE ops.run r
         SET status = 'cancelled', finished_at = now()
         FROM ops.goal g
         WHERE r.id = $1 AND r.goal_id = g.id AND g.org_id = $2
           AND r.status IN ('queued', 'running')
         RETURNING r.*`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      const run = rows[0]!;
      await audit(
        {
          scope,
          action: "run.cancel",
          target_type: "run",
          target_id: run.id,
          metadata: { goal_id: run.goal_id },
        },
        client,
      );
      return run;
    });
    if (!result) {
      return reply.code(409).send({ error: "not_cancellable_or_not_found" });
    }
    return result;
  });
}
