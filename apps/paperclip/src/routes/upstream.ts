/**
 * Upstream knowledge sources (Phase 2.5).
 *
 *   POST   /api/upstream                  register a new source
 *   GET    /api/upstream                  list sources for the org
 *   GET    /api/upstream/:id              one source + last_* state
 *   PATCH  /api/upstream/:id              update name / tags / interval / enabled
 *   POST   /api/upstream/:id/pull         manual pull now (synchronous)
 *   DELETE /api/upstream/:id              remove the source (last linked
 *                                         document also deleted)
 *
 * The scheduler ticks each source on its `refresh_interval_seconds`. The
 * manual pull endpoint is the operator's escape hatch for "I want it
 * now." Both paths route through `pullUpstreamSource()` in upstream/pull.ts
 * so they share the dedupe + atomic-replace + audit logic.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import { UpstreamSourceCreate, UpstreamSourcePatch } from "../schemas.js";
import { pullUpstreamSource, type UpstreamSourceRow } from "../upstream/pull.js";

const UPSTREAM_COLUMNS =
  "id, org_id, scope, name, source_url, tags, refresh_interval_seconds, last_pulled_at, last_content_hash, last_document_id, last_status, last_error, consecutive_failures, enabled, created_at, updated_at";

export async function upstreamRoutes(app: FastifyInstance): Promise<void> {
  // -- create -------------------------------------------------------------
  app.post("/api/upstream", async (req, reply) => {
    const parsed = UpstreamSourceCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      // Per-org uniqueness on source_url — refuse duplicates rather than
      // silently overwriting.
      const { rows: dup } = await client.query<{ id: string }>(
        "SELECT id FROM ops.upstream_source WHERE org_id = $1 AND source_url = $2",
        [scope.org_id, parsed.data.source_url],
      );
      if (dup.length > 0) {
        return { kind: "duplicate" as const, id: dup[0]!.id };
      }

      const { rows } = await client.query<UpstreamSourceRow>(
        `INSERT INTO ops.upstream_source
            (org_id, scope, name, source_url, tags, refresh_interval_seconds)
         VALUES ($1, $2::ops.skill_scope, $3, $4, $5::text[], $6)
         RETURNING ${UPSTREAM_COLUMNS}`,
        [
          scope.org_id,
          parsed.data.scope,
          parsed.data.name,
          parsed.data.source_url,
          parsed.data.tags,
          parsed.data.refresh_interval_seconds,
        ],
      );
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "upstream.create",
          target_type: "upstream_source",
          target_id: row.id,
          metadata: {
            name: row.name,
            source_url: row.source_url,
            interval: row.refresh_interval_seconds,
          },
        },
        client,
      );
      return { kind: "ok" as const, row };
    });
    if (result.kind === "duplicate") {
      return reply.code(409).send({ error: "duplicate_source_url", existing_id: result.id });
    }
    return reply.code(201).send(result.row);
  });

  // -- list ---------------------------------------------------------------
  app.get<{ Querystring: { enabled?: string; tag?: string } }>(
    "/api/upstream",
    async (req) => {
      const scope = await resolveCallerScope(req);
      const where: string[] = ["org_id = $1"];
      const params: unknown[] = [scope.org_id];
      if (req.query.enabled === "true") where.push("enabled = true");
      if (req.query.enabled === "false") where.push("enabled = false");
      if (req.query.tag) {
        params.push(req.query.tag);
        where.push(`$${params.length} = ANY(tags)`);
      }
      return withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<UpstreamSourceRow>(
          `SELECT ${UPSTREAM_COLUMNS} FROM ops.upstream_source
            WHERE ${where.join(" AND ")}
            ORDER BY created_at DESC`,
          params,
        );
        return rows;
      });
    },
  );

  // -- get one ------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/upstream/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const row = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<UpstreamSourceRow>(
        `SELECT ${UPSTREAM_COLUMNS} FROM ops.upstream_source
          WHERE id = $1 AND org_id = $2`,
        [req.params.id, scope.org_id],
      );
      return rows[0] ?? null;
    });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return row;
  });

  // -- patch --------------------------------------------------------------
  app.patch<{ Params: { id: string } }>("/api/upstream/:id", async (req, reply) => {
    const parsed = UpstreamSourcePatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const sets: string[] = [];
    const params: unknown[] = [req.params.id, scope.org_id];
    const setCol = (col: string, val: unknown, cast?: string): void => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast ?? ""}`);
    };
    if (parsed.data.name !== undefined) setCol("name", parsed.data.name);
    if (parsed.data.scope !== undefined) setCol("scope", parsed.data.scope, "::ops.skill_scope");
    if (parsed.data.tags !== undefined) setCol("tags", parsed.data.tags, "::text[]");
    if (parsed.data.refresh_interval_seconds !== undefined)
      setCol("refresh_interval_seconds", parsed.data.refresh_interval_seconds);
    if (parsed.data.enabled !== undefined) {
      setCol("enabled", parsed.data.enabled);
      // Re-enabling resets the failure counter so the scheduler will
      // try the source again on the next tick.
      if (parsed.data.enabled === true) sets.push(`consecutive_failures = 0`);
    }
    if (sets.length === 0) return reply.code(400).send({ error: "no_changes" });
    sets.push("updated_at = now()");

    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<UpstreamSourceRow>(
        `UPDATE ops.upstream_source SET ${sets.join(", ")}
          WHERE id = $1 AND org_id = $2
          RETURNING ${UPSTREAM_COLUMNS}`,
        params,
      );
      if (rows.length === 0) return null;
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "upstream.patch",
          target_type: "upstream_source",
          target_id: row.id,
          metadata: parsed.data as Record<string, unknown>,
        },
        client,
      );
      return row;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return result;
  });

  // -- manual pull --------------------------------------------------------
  // Synchronous: blocks the request until the fetch + ingest finishes.
  // Use the GET endpoint afterwards to read the fresh last_* state.
  app.post<{ Params: { id: string } }>("/api/upstream/:id/pull", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const source = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<UpstreamSourceRow>(
        `SELECT ${UPSTREAM_COLUMNS} FROM ops.upstream_source
          WHERE id = $1 AND org_id = $2`,
        [req.params.id, scope.org_id],
      );
      return rows[0] ?? null;
    });
    if (!source) return reply.code(404).send({ error: "not_found" });

    const outcome = await pullUpstreamSource(source);
    return {
      source_id: source.id,
      outcome,
    };
  });

  // -- delete -------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/api/upstream/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      // Capture last_document_id before removing the source so we can
      // delete the linked doc too. ON DELETE SET NULL on document.upstream
      // means the doc would otherwise become an orphaned ad-hoc row.
      const { rows: existing } = await client.query<{
        id: string;
        last_document_id: string | null;
        name: string;
        source_url: string;
      }>(
        `SELECT id, last_document_id, name, source_url
           FROM ops.upstream_source WHERE id = $1 AND org_id = $2`,
        [req.params.id, scope.org_id],
      );
      if (existing.length === 0) return undefined;
      const row = existing[0]!;
      if (row.last_document_id) {
        await client.query("DELETE FROM ops.document WHERE id = $1 AND org_id = $2", [
          row.last_document_id,
          scope.org_id,
        ]);
      }
      await client.query(
        "DELETE FROM ops.upstream_source WHERE id = $1 AND org_id = $2",
        [row.id, scope.org_id],
      );
      await audit(
        {
          scope,
          action: "upstream.delete",
          target_type: "upstream_source",
          target_id: row.id,
          metadata: {
            name: row.name,
            source_url: row.source_url,
            removed_document_id: row.last_document_id,
          },
        },
        client,
      );
      return row;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
