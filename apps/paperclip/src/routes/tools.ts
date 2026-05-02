/**
 * Tools API — discoverable MCP tool registry + invocation.
 *
 *   GET    /api/tools                    list visible tools
 *   GET    /api/tools/:slug              single manifest
 *   POST   /api/tools/:slug/invoke       run the tool with given input
 *
 * Invocation spawns the tool's stdio subprocess (e.g. `npx @mcp/server-fetch`),
 * speaks JSON-RPC, kills the subprocess, returns the result. Each call is
 * recorded in `ops.tool_call_log` with input/output/latency/error.
 *
 * Direct tool invocation does NOT pass through the policy engine — operator
 * intent is implicit when calling `bc tool invoke` or hitting the route
 * directly. Agent-initiated tool use happens through skills, which DO go
 * through the policy engine.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import { ToolInvokeBody } from "../schemas.js";
import {
  type InvokeStdioToolDeps,
  type InvokeStdioToolResult,
  invokeStdioTool,
  probeStdioTool,
} from "../tools/client.js";
import { recordToolCall } from "../tools/log.js";

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
  tool_name: string | null;
  manifest_path: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

const TOOL_COLUMNS =
  "id, org_id, slug, version, scope, name, description, transport, target, env_keys, input_schema, tool_name, manifest_path, enabled, created_at, updated_at";

/** Default tool name = segment after the last `.` in the slug. */
function deriveToolName(slug: string): string {
  const idx = slug.lastIndexOf(".");
  return idx === -1 ? slug : slug.slice(idx + 1);
}

export type ToolRoutesDeps = {
  /** Override the MCP invoker for tests. */
  invoker?: typeof invokeStdioTool;
  /** Override the spawn used by the default invoker. */
  invokerDeps?: InvokeStdioToolDeps;
};

export async function toolRoutes(
  app: FastifyInstance,
  deps: ToolRoutesDeps = {},
): Promise<void> {
  const invoke = deps.invoker ?? invokeStdioTool;
  const invokerDeps = deps.invokerDeps ?? {};

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

  // -- invoke -------------------------------------------------------------
  app.post<{ Params: { slug: string } }>("/api/tools/:slug/invoke", async (req, reply) => {
    const parsed = ToolInvokeBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);

    // 1. Look up the tool. Lowest version OK; we always use the latest.
    const tool = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<ToolRow>(
        `SELECT ${TOOL_COLUMNS} FROM ops.tool
          WHERE slug = $1
            AND (org_id IS NULL OR org_id = $2)
            AND enabled = true
          ORDER BY version DESC LIMIT 1`,
        [req.params.slug, scope.org_id],
      );
      return rows[0] ?? null;
    });
    if (!tool) return reply.code(404).send({ error: "tool_not_found" });

    // 2. Only stdio is wired for v0. Other transports return 501 cleanly.
    if (tool.transport !== "stdio") {
      return reply.code(501).send({
        error: "transport_not_supported",
        detail: `transport='${tool.transport}' invocation is not implemented in v0; only stdio is.`,
      });
    }

    // 3. Validate env_keys are set in the host env. Fail-fast with a
    //    helpful message rather than spawning a subprocess that errors
    //    cryptically inside the JSON-RPC handshake.
    const envKeys = Array.isArray(tool.env_keys) ? tool.env_keys : [];
    const missingEnv = envKeys.filter((k) => !process.env[k]);
    if (missingEnv.length > 0) {
      return reply.code(412).send({
        error: "missing_env_keys",
        detail: `tool '${tool.slug}' requires env vars: ${missingEnv.join(", ")}`,
        missing: missingEnv,
      });
    }

    // 4. Invoke. Per-call timeout cap = manifest default (30s) or body
    //    override capped at 60s.
    const toolName = tool.tool_name ?? deriveToolName(tool.slug);
    let result: InvokeStdioToolResult;
    try {
      result = await invoke(
        {
          command: tool.target,
          toolName,
          arguments: parsed.data.input,
          timeoutMs: parsed.data.timeout_ms,
        },
        invokerDeps,
      );
    } catch (err) {
      result = {
        output: null,
        is_error: true,
        latency_ms: 0,
        error: (err as Error).message,
        stderr_tail: null,
      };
    }

    // 5. Log + audit. Best-effort; failures don't break the response.
    await recordToolCall({
      orgId: scope.org_id,
      runId: parsed.data.run_id ?? null,
      toolSlug: tool.slug,
      toolVersion: tool.version,
      input: parsed.data.input,
      output: result.output,
      isError: result.is_error,
      error: result.error,
      latencyMs: result.latency_ms,
      stderrTail: result.stderr_tail,
    });
    await audit(
      {
        scope,
        action: "tool.invoke",
        target_type: "tool",
        target_id: tool.id,
        metadata: {
          slug: tool.slug,
          version: tool.version,
          is_error: result.is_error,
          latency_ms: result.latency_ms,
          run_id: parsed.data.run_id ?? null,
        },
      },
    );

    if (result.is_error) {
      return reply.code(502).send({
        error: "tool_call_failed",
        slug: tool.slug,
        detail: result.error,
        latency_ms: result.latency_ms,
        stderr_tail: result.stderr_tail,
      });
    }
    return {
      slug: tool.slug,
      version: tool.version,
      output: result.output,
      latency_ms: result.latency_ms,
    };
  });

  // -- probe --------------------------------------------------------------
  // Liveness check: spawns the subprocess and runs the MCP `initialize`
  // handshake only. Re-enables a previously auto-disabled tool if the
  // probe now succeeds, so operators can fix a tool's env / install and
  // bring it back without restarting paperclip.
  app.post<{ Params: { slug: string } }>("/api/tools/:slug/probe", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const tool = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<ToolRow>(
        `SELECT ${TOOL_COLUMNS} FROM ops.tool
          WHERE slug = $1
            AND (org_id IS NULL OR org_id = $2)
          ORDER BY version DESC LIMIT 1`,
        [req.params.slug, scope.org_id],
      );
      return rows[0] ?? null;
    });
    if (!tool) return reply.code(404).send({ error: "tool_not_found" });
    if (tool.transport !== "stdio") {
      return reply.code(501).send({
        error: "transport_not_supported",
        detail: `probe is implemented for stdio only; tool '${tool.slug}' uses '${tool.transport}'.`,
      });
    }
    const probe = await probeStdioTool({ command: tool.target }, invokerDeps);
    // If healthy and previously disabled, flip back to enabled.
    if (probe.ok && !tool.enabled) {
      await withOrgScope(scope.org_id, async (client) => {
        await client.query(
          `UPDATE ops.tool SET enabled = true, updated_at = now() WHERE id = $1`,
          [tool.id],
        );
      });
    }
    // If unhealthy and currently enabled, disable it so list calls reflect reality.
    if (!probe.ok && tool.enabled) {
      await withOrgScope(scope.org_id, async (client) => {
        await client.query(
          `UPDATE ops.tool SET enabled = false, updated_at = now() WHERE id = $1`,
          [tool.id],
        );
      });
    }
    await audit({
      scope,
      action: "tool.probe",
      target_type: "tool",
      target_id: tool.id,
      metadata: { slug: tool.slug, ok: probe.ok, latency_ms: probe.latency_ms },
    });
    return {
      slug: tool.slug,
      ok: probe.ok,
      latency_ms: probe.latency_ms,
      error: probe.error,
      stderr_tail: probe.stderr_tail,
      enabled: probe.ok || (probe.ok === false ? false : tool.enabled),
    };
  });
}
