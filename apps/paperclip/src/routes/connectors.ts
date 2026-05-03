/**
 * Connectors API.
 *
 *   GET    /api/connectors                       list
 *   GET    /api/connectors/:id                   one
 *   GET    /api/connectors/providers             provider catalogue (registry)
 *   POST   /api/connectors                       create
 *   PATCH  /api/connectors/:id                   edit (including enabled toggle)
 *   DELETE /api/connectors/:id                   delete (cascades artifacts)
 *   POST   /api/connectors/:id/sync              manual sync trigger
 *   POST   /api/connectors/:id/paste             manual_paste fast path
 *   GET    /api/connectors/:id/artifacts         per-connector ingest history
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import {
  ConnectorCreate,
  ConnectorPaste,
  ConnectorPatch,
} from "../schemas.js";
import { listProviders, getProvider } from "../connectors/registry.js";
import { ingestPaste, syncOneConnector } from "../connectors/sync.js";
import type { ConnectorRow } from "../connectors/types.js";

const COLUMNS = `
  id, org_id, provider, name, scope, nango_connection_id, config,
  refresh_interval_seconds, last_synced_at, last_status, last_error,
  consecutive_failures, enabled, created_at, updated_at
`;

export async function connectorRoutes(app: FastifyInstance): Promise<void> {
  // -- provider catalogue ------------------------------------------------
  app.get("/api/connectors/providers", async () => {
    return { providers: listProviders().map((p) => p.info) };
  });

  // -- list --------------------------------------------------------------
  app.get("/api/connectors", async (req) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<ConnectorRow>(
        `SELECT ${COLUMNS} FROM ops.connector
          WHERE org_id = $1
          ORDER BY enabled DESC, updated_at DESC`,
        [scope.org_id],
      );
      return rows;
    });
  });

  // -- get one -----------------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/connectors/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const rows = await withOrgScope(scope.org_id, async (client) => {
      const { rows: rs } = await client.query<ConnectorRow>(
        `SELECT ${COLUMNS} FROM ops.connector WHERE id = $1 AND org_id = $2`,
        [req.params.id, scope.org_id],
      );
      return rs;
    });
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });

  // -- create ------------------------------------------------------------
  app.post("/api/connectors", async (req, reply) => {
    const parsed = ConnectorCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const provider = getProvider(parsed.data.provider);
    if (!provider) {
      return reply.code(400).send({ error: "unknown_provider", provider: parsed.data.provider });
    }
    const validation = provider.validateConfig(parsed.data.config);
    if (validation) {
      return reply.code(400).send({ error: "invalid_config", message: validation });
    }
    if (provider.info.status === "needs_oauth" && !parsed.data.nango_connection_id) {
      return reply.code(400).send({
        error: "nango_connection_required",
        message: `Provider ${provider.info.key} needs an OAuth connection. Run the Nango Connect flow and supply nango_connection_id.`,
      });
    }
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<ConnectorRow>(
        `INSERT INTO ops.connector
           (org_id, provider, name, scope, nango_connection_id, config,
            refresh_interval_seconds)
         VALUES ($1, $2, $3, $4::ops.skill_scope, $5, $6::jsonb, $7)
         RETURNING ${COLUMNS}`,
        [
          scope.org_id,
          parsed.data.provider,
          parsed.data.name,
          parsed.data.scope,
          parsed.data.nango_connection_id ?? null,
          JSON.stringify(parsed.data.config),
          parsed.data.refresh_interval_seconds,
        ],
      );
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "connector.create",
          target_type: "connector",
          target_id: row.id,
          metadata: {
            provider: row.provider,
            scope: row.scope,
            has_nango_connection: !!row.nango_connection_id,
          },
        },
        client,
      );
      return row;
    });
    return reply.code(201).send(result);
  });

  // -- patch -------------------------------------------------------------
  app.patch<{ Params: { id: string } }>("/api/connectors/:id", async (req, reply) => {
    const parsed = ConnectorPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);

    // If config is being updated, re-validate against the provider.
    if (parsed.data.config !== undefined) {
      const existing = await withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<{ provider: string }>(
          `SELECT provider FROM ops.connector WHERE id = $1 AND org_id = $2`,
          [req.params.id, scope.org_id],
        );
        return rows[0];
      });
      if (!existing) return reply.code(404).send({ error: "not_found" });
      const provider = getProvider(existing.provider);
      if (provider) {
        const validation = provider.validateConfig(parsed.data.config);
        if (validation) {
          return reply.code(400).send({ error: "invalid_config", message: validation });
        }
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [req.params.id, scope.org_id];
    const setCol = (col: string, val: unknown, cast?: string): void => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast ?? ""}`);
    };
    if (parsed.data.name !== undefined) setCol("name", parsed.data.name);
    if (parsed.data.scope !== undefined) setCol("scope", parsed.data.scope, "::ops.skill_scope");
    if (parsed.data.nango_connection_id !== undefined) setCol("nango_connection_id", parsed.data.nango_connection_id);
    if (parsed.data.config !== undefined) setCol("config", JSON.stringify(parsed.data.config), "::jsonb");
    if (parsed.data.refresh_interval_seconds !== undefined) setCol("refresh_interval_seconds", parsed.data.refresh_interval_seconds);
    if (parsed.data.enabled !== undefined) {
      setCol("enabled", parsed.data.enabled);
      // Re-enabling clears the failure counter so the operator gets a clean
      // slate after fixing whatever was wrong.
      if (parsed.data.enabled) sets.push("consecutive_failures = 0");
    }
    if (sets.length === 0) return reply.code(400).send({ error: "no_changes" });
    sets.push("updated_at = now()");

    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<ConnectorRow>(
        `UPDATE ops.connector SET ${sets.join(", ")}
          WHERE id = $1 AND org_id = $2
          RETURNING ${COLUMNS}`,
        params,
      );
      if (rows.length === 0) return undefined;
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "connector.update",
          target_type: "connector",
          target_id: row.id,
          metadata: { fields: Object.keys(parsed.data) },
        },
        client,
      );
      return row;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return result;
  });

  // -- delete ------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/api/connectors/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<{ id: string; provider: string }>(
        `DELETE FROM ops.connector WHERE id = $1 AND org_id = $2
          RETURNING id, provider`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "connector.delete",
          target_type: "connector",
          target_id: row.id,
          metadata: { provider: row.provider },
        },
        client,
      );
      return row;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // -- manual sync -------------------------------------------------------
  app.post<{ Params: { id: string } }>("/api/connectors/:id/sync", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await syncOneConnector(scope.org_id, req.params.id, scope);
    if (result.status === "failed" && result.error === "connector not found") {
      return reply.code(404).send({ error: "not_found" });
    }
    return result;
  });

  // -- manual paste ------------------------------------------------------
  app.post<{ Params: { id: string } }>("/api/connectors/:id/paste", async (req, reply) => {
    const parsed = ConnectorPaste.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    try {
      const result = await ingestPaste(
        scope.org_id,
        req.params.id,
        {
          external_id: parsed.data.external_id,
          title: parsed.data.title,
          content_md: parsed.data.content_md,
          metadata: parsed.data.metadata,
          tags: parsed.data.tags,
        },
        scope,
      );
      return reply.code(201).send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) return reply.code(404).send({ error: "not_found" });
      return reply.code(400).send({ error: "paste_failed", message: msg });
    }
  });

  // -- artifacts ---------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/api/connectors/:id/artifacts",
    async (req) => {
      const scope = await resolveCallerScope(req);
      return withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query(
          `SELECT id, external_id, document_id, content_hash,
                  last_seen_at, metadata, created_at, updated_at
             FROM ops.connector_artifact
            WHERE connector_id = $1 AND org_id = $2
            ORDER BY last_seen_at DESC
            LIMIT 100`,
          [req.params.id, scope.org_id],
        );
        return rows;
      });
    },
  );
}
