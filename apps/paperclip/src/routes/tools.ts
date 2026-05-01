/**
 * Tools API — discoverable MCP tool registry.
 *
 *   GET    /api/tools              list visible tools (shared + this org's)
 *   GET    /api/tools/:slug         single manifest
 *
 * Invocation lives in a future Phase-5 sprint once we wire an MCP client
 * transport. For now this is a registry / browser surface.
 */

import type { FastifyInstance } from "fastify";

import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";

type ToolRow = {
  id: string;
  org_id: string | null;
  slug: string;
  version: number;
  scope: "personal" | "company" | "shared";
  name: string;
  description: string | null;
  transport: "stdio" | "http" | "sse" | "websocket";
  target: string;
  env_keys: string[];
  input_schema: Record<string, unknown>;
  manifest_path: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

const TOOL_COLUMNS =
  "id, org_id, slug, version, scope, name, description, transport, target, env_keys, input_schema, manifest_path, enabled, created_at, updated_at";

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  // -- list ---------------------------------------------------------------
  app.get<{ Querystring: { transport?: string; enabled?: string } }>("/api/tools", async (req) => {
    const scope = await resolveCallerScope(req);
    const where: string[] = ["(org_id IS NULL OR org_id = $1)"];
    const params: unknown[] = [scope.org_id];
    if (req.query.transport) {
      params.push(req.query.transport);
      where.push(`transport = $${params.length}::ops.tool_transport`);
    }
    if (req.query.enabled === "true") where.push("enabled = true");
    if (req.query.enabled === "false") where.push("enabled = false");
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<ToolRow>(
        `SELECT ${TOOL_COLUMNS} FROM ops.tool
          WHERE ${where.join(" AND ")}
          ORDER BY scope DESC, slug ASC, version DESC`,
        params,
      );
      return rows;
    });
  });

  // -- get ----------------------------------------------------------------
  app.get<{ Params: { slug: string } }>("/api/tools/:slug", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<ToolRow>(
        `SELECT ${TOOL_COLUMNS} FROM ops.tool
          WHERE slug = $1
            AND (org_id IS NULL OR org_id = $2)
          ORDER BY version DESC LIMIT 1`,
        [req.params.slug, scope.org_id],
      );
      if (rows.length === 0) return reply.code(404).send({ error: "tool_not_found" });
      return rows[0];
    });
  });
}
