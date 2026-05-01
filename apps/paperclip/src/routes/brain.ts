/**
 * Brain graph — synthesized nodes + edges for the design's constellation page.
 *
 * v0 derives the graph from the operational tables we already have (goals,
 * agents, captures, audit log). It is not the canonical knowledge graph —
 * Graphiti owns that, and a future Graphiti-backed `/graph` endpoint will
 * replace this one. But Graphiti's adapter exposes /add and /search, not
 * /graph, so for the UI to ship we synthesize.
 *
 * Node kinds in the response: person | agent | goal | capture | tool.
 *   - person/agent come from core.user_account / ops.agent
 *   - goal comes from ops.goal (active + recently-touched)
 *   - capture appears for the most recent N captures (the "what just got
 *     thrown at the system" cloud)
 *   - tool will appear once Nango / MCP wiring lands; v0 returns []
 *
 * Edges:
 *   - person→goal      (owner_id)
 *   - agent→goal       (ops.goal_contributor.agent_id)
 *   - person→goal      (ops.goal_contributor.user_id)
 *   - capture→goal     (ops.capture.resolved_to_id)
 *   - agent→goal       (ops.run.agent_id) for recent runs
 */

import type { FastifyInstance } from "fastify";

import { query } from "../db.js";
import { resolveCallerScope } from "../scope.js";

export type BrainNodeKind = "person" | "agent" | "goal" | "capture" | "tool";

export type BrainNode = {
  id: string;
  kind: BrainNodeKind;
  label: string;
  metadata?: Record<string, unknown>;
};

export type BrainEdge = {
  from: string;
  to: string;
  kind: "owns" | "contributes" | "captures" | "ran";
};

export type BrainGraph = {
  nodes: BrainNode[];
  edges: BrainEdge[];
  truncated: boolean;
  generated_at: string;
};

const DEFAULT_LIMIT = 80;

export async function brainRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>("/api/brain/graph", async (req) => {
    const scope = await resolveCallerScope(req);
    const limit = Math.min(Math.max(Number(req.query.limit ?? DEFAULT_LIMIT), 10), 200);

    const [people, agents, goals, captures, contributors, runs] = await Promise.all([
      query<{ id: string; display_name: string | null; email: string }>(
        `SELECT id, display_name, email
           FROM core.user_account
          WHERE org_id = $1 AND is_active = true
          LIMIT $2`,
        [scope.org_id, limit],
      ),
      query<{ id: string; name: string; kind: string; is_active: boolean }>(
        `SELECT id, name, kind, is_active
           FROM ops.agent
          WHERE org_id = $1 AND is_active = true
          ORDER BY created_at ASC
          LIMIT $2`,
        [scope.org_id, limit],
      ),
      query<{ id: string; title: string; kind: string; status: string; owner_id: string | null }>(
        `SELECT id, title, kind, status, owner_id
           FROM ops.goal
          WHERE org_id = $1
            AND status IN ('draft','active','paused','achieved')
          ORDER BY updated_at DESC
          LIMIT $2`,
        [scope.org_id, limit],
      ),
      query<{ id: string; raw_content: string; resolved_to_id: string | null; resolved_kind: string | null }>(
        `SELECT id, raw_content, resolved_to_id, resolved_kind
           FROM ops.capture
          WHERE org_id = $1
          ORDER BY created_at DESC
          LIMIT 20`,
        [scope.org_id],
      ),
      query<{ goal_id: string; agent_id: string | null; user_id: string | null }>(
        `SELECT gc.goal_id, gc.agent_id, gc.user_id
           FROM ops.goal_contributor gc
           JOIN ops.goal g ON g.id = gc.goal_id
          WHERE g.org_id = $1
          LIMIT $2`,
        [scope.org_id, limit * 4],
      ),
      query<{ goal_id: string; agent_id: string }>(
        `SELECT DISTINCT r.goal_id, r.agent_id
           FROM ops.run r
           JOIN ops.goal g ON g.id = r.goal_id
          WHERE g.org_id = $1
            AND r.agent_id IS NOT NULL
            AND r.created_at >= now() - interval '14 days'
          LIMIT $2`,
        [scope.org_id, limit * 4],
      ),
    ]);

    const nodes: BrainNode[] = [];
    const seen = new Set<string>();
    const addNode = (n: BrainNode): void => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      nodes.push(n);
    };

    for (const p of people.rows) {
      addNode({
        id: p.id,
        kind: "person",
        label: p.display_name ?? p.email,
      });
    }
    for (const a of agents.rows) {
      addNode({
        id: a.id,
        kind: "agent",
        label: a.name,
        metadata: { agent_kind: a.kind },
      });
    }
    for (const g of goals.rows) {
      addNode({
        id: g.id,
        kind: "goal",
        label: g.title.length > 80 ? g.title.slice(0, 77) + "…" : g.title,
        metadata: { goal_kind: g.kind, status: g.status },
      });
    }
    for (const c of captures.rows) {
      addNode({
        id: c.id,
        kind: "capture",
        label: c.raw_content.slice(0, 60) + (c.raw_content.length > 60 ? "…" : ""),
      });
    }

    const edges: BrainEdge[] = [];
    const edgeKey = (e: BrainEdge): string => `${e.from}|${e.to}|${e.kind}`;
    const seenEdge = new Set<string>();
    const addEdge = (e: BrainEdge): void => {
      // Skip edges where either side wasn't surfaced as a node.
      if (!seen.has(e.from) || !seen.has(e.to)) return;
      const k = edgeKey(e);
      if (seenEdge.has(k)) return;
      seenEdge.add(k);
      edges.push(e);
    };

    for (const g of goals.rows) {
      if (g.owner_id) addEdge({ from: g.owner_id, to: g.id, kind: "owns" });
    }
    for (const c of contributors.rows) {
      if (c.agent_id) addEdge({ from: c.agent_id, to: c.goal_id, kind: "contributes" });
      if (c.user_id)  addEdge({ from: c.user_id,  to: c.goal_id, kind: "contributes" });
    }
    for (const r of runs.rows) {
      addEdge({ from: r.agent_id, to: r.goal_id, kind: "ran" });
    }
    for (const c of captures.rows) {
      if (c.resolved_to_id && c.resolved_kind === "goal") {
        addEdge({ from: c.id, to: c.resolved_to_id, kind: "captures" });
      }
    }

    const truncated =
      goals.rows.length >= limit ||
      agents.rows.length >= limit ||
      people.rows.length >= limit;

    const graph: BrainGraph = {
      nodes,
      edges,
      truncated,
      generated_at: new Date().toISOString(),
    };
    return graph;
  });
}
