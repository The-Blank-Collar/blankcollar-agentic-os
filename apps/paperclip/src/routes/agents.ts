import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
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

type RunRow = {
  id: string;
  goal_id: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  goal_title: string | null;
};

export type AgentState = AgentRow & {
  status: "live" | "idle" | "warn";
  current_activity: string | null;
  last_run: RunRow | null;
  recent_runs: RunRow[];
  sigil_seed: string;
};

/**
 * Deterministic sigil seed used by the UI to render the agent's geometric
 * mark. Stable across requests so the visual identity is constant.
 */
export function sigilSeed(agent: { id: string; name: string; kind: string }): string {
  const slug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug}-${agent.kind}-${agent.id.slice(0, 8)}`;
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { is_active?: string } }>("/api/agents", async (req) => {
    const scope = await resolveCallerScope(req);
    const where: string[] = ["org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (req.query.is_active === "true") where.push("is_active = true");
    if (req.query.is_active === "false") where.push("is_active = false");
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<AgentRow>(
        `SELECT id, org_id, kind, name, config, is_active, created_at
         FROM ops.agent
         WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC`,
        params,
      );
      return rows;
    });
  });

  app.post("/api/agents", async (req, reply) => {
    const parsed = AgentCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
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
    const scope = await resolveCallerScope(req);
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

    const result = await withOrgScope(scope.org_id, async (client) => {
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

  // -- per-agent state ----------------------------------------------------
  // Powers the design's Live agents rail and Team page. All derived from
  // existing data — config.activity is the static description, the live
  // status comes from ops.run.
  app.get<{ Params: { id: string } }>("/api/agents/:id/state", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const data = await withOrgScope(scope.org_id, async (client) => {
      const { rows: agentRows } = await client.query<AgentRow>(
        `SELECT id, org_id, kind, name, config, is_active, created_at
           FROM ops.agent WHERE id = $1 AND org_id = $2`,
        [req.params.id, scope.org_id],
      );
      if (agentRows.length === 0) return null;
      const agent = agentRows[0]!;
      const { rows: runRows } = await client.query<RunRow>(
        `SELECT r.id, r.goal_id, r.status, r.input, r.output, r.error,
                r.started_at, r.finished_at, r.created_at, g.title AS goal_title
           FROM ops.run r
           JOIN ops.goal g ON g.id = r.goal_id
          WHERE r.agent_id = $1 AND g.org_id = $2
          ORDER BY r.created_at DESC
          LIMIT 5`,
        [agent.id, scope.org_id],
      );
      return { agent, runRows };
    });
    if (!data) return reply.code(404).send({ error: "not_found" });
    const { agent, runRows } = data;

    const live = runRows.find((r) => r.status === "running") ?? null;
    const lastTerminal = runRows.find((r) =>
      r.status === "succeeded" || r.status === "failed" || r.status === "cancelled",
    ) ?? null;

    let status: AgentState["status"] = "idle";
    let current_activity: string | null = null;
    if (live) {
      status = "live";
      const inputSubtask = (live.input as { subtask?: { title?: string } } | null)?.subtask;
      current_activity = inputSubtask?.title
        ? `Working on: ${inputSubtask.title}`
        : live.goal_title
          ? `Working on: ${live.goal_title}`
          : "Working";
    } else if (lastTerminal && lastTerminal.status === "failed") {
      status = "warn";
      current_activity = lastTerminal.error
        ? `Last task failed: ${lastTerminal.error.slice(0, 120)}`
        : "Last task failed";
    } else {
      const fallback = (agent.config as { activity?: string } | null)?.activity;
      current_activity = fallback ?? null;
    }

    const state: AgentState = {
      ...agent,
      status,
      current_activity,
      last_run: lastTerminal ?? live ?? null,
      recent_runs: runRows,
      sigil_seed: sigilSeed(agent),
    };
    return state;
  });
}
