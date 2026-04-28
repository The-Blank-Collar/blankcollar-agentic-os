import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { query, tx } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import { AgentCreate, AgentPatch } from "../schemas.js";

type AgentRow = {
  id: string;
  org_id: string;
  kind: string;
  name: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
};

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { is_active?: string } }>("/api/agents", async (req) => {
    const scope = await resolveCallerScope();
    const where: string[] = ["org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (req.query.is_active === "true") where.push("is_active = true");
    if (req.query.is_active === "false") where.push("is_active = false");
    const { rows } = await query<AgentRow>(
      `SELECT id, org_id, kind, name, config, is_active, created_at
       FROM ops.agent
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC`,
      params,
    );
    return rows;
  });

  app.post("/api/agents", async (req, reply) => {
    const parsed = AgentCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope();
    const result = await tx(async (client) => {
      const { rows } = await client.query<AgentRow>(
        `INSERT INTO ops.agent (org_id, kind, name, config)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, org_id, kind, name, config, is_active, created_at`,
        [scope.org_id, parsed.data.kind, parsed.data.name, JSON.stringify(parsed.data.config)],
      );
      const agent = rows[0]!;
      await audit(
        {
          scope,
          action: "agent.hire",
          target_type: "agent",
          target_id: agent.id,
          metadata: { kind: agent.kind, name: agent.name },
        },
        client,
      );
      return agent;
    });
    return reply.code(201).send(result);
  });

  app.patch<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const parsed = AgentPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope();
    const sets: string[] = [];
    const params: unknown[] = [req.params.id, scope.org_id];
    if (parsed.data.name !== undefined) {
      params.push(parsed.data.name);
      sets.push(`name = $${params.length}`);
    }
    if (parsed.data.config !== undefined) {
      params.push(JSON.stringify(parsed.data.config));
      sets.push(`config = $${params.length}::jsonb`);
    }
    if (parsed.data.is_active !== undefined) {
      params.push(parsed.data.is_active);
      sets.push(`is_active = $${params.length}`);
    }
    if (sets.length === 0) return reply.code(400).send({ error: "no_changes" });

    const result = await tx(async (client) => {
      const { rows } = await client.query<AgentRow>(
        `UPDATE ops.agent SET ${sets.join(", ")} WHERE id = $1 AND org_id = $2
         RETURNING id, org_id, kind, name, config, is_active, created_at`,
        params,
      );
      if (rows.length === 0) return undefined;
      const agent = rows[0]!;
      const action = parsed.data.is_active === false ? "agent.fire" : "agent.update";
      await audit(
        { scope, action, target_type: "agent", target_id: agent.id, metadata: parsed.data },
        client,
      );
      return agent;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return result;
  });
}
