/**
 * Document ingestion API (Phase 2.4).
 *
 *   POST   /api/documents/markdown          ingest a markdown blob
 *   GET    /api/documents                   list ingested docs
 *   GET    /api/documents/:id               single doc + metadata
 *   GET    /api/documents/:id/chunks        all chunks of one doc
 *   GET    /api/documents/search?q=text     keyword search across chunks
 *   DELETE /api/documents/:id               delete a doc (chunks cascade)
 *
 * Dedupe: per-org unique on (content_hash). Re-uploading the same content
 * returns the existing document_id by default. Pass `force=true` to
 * replace (delete the prior row + chunks, re-ingest).
 *
 * Vector embeddings (gbrain) are NOT triggered in v0 — chunks are
 * keyword-searchable via the GIN tsvector index immediately. Wiring
 * `gbrain.remember` per chunk as a non-blocking follow-up is next.
 */

import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { chunkText } from "../documents/chunker.js";
import { resolveCallerScope } from "../scope.js";
import { DocumentMarkdownCreate } from "../schemas.js";

type DocRow = {
  id: string;
  org_id: string;
  scope: "personal" | "company" | "shared";
  title: string;
  source_url: string | null;
  source_filename: string | null;
  mime_type: string;
  content_hash: string;
  tags: string[];
  char_count: number;
  chunk_count: number;
  ingested_at: string;
  created_at: string;
  updated_at: string;
};

type ChunkRow = {
  id: string;
  document_id: string;
  org_id: string;
  chunk_index: number;
  total_chunks: number;
  text: string;
  char_start: number;
  char_end: number;
  memory_id: string | null;
  created_at: string;
};

const DOC_COLUMNS =
  "id, org_id, scope, title, source_url, source_filename, mime_type, content_hash, tags, char_count, chunk_count, ingested_at, created_at, updated_at";
const CHUNK_COLUMNS =
  "id, document_id, org_id, chunk_index, total_chunks, text, char_start, char_end, memory_id, created_at";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  // -- ingest markdown ---------------------------------------------------
  app.post("/api/documents/markdown", async (req, reply) => {
    const parsed = DocumentMarkdownCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const scope = await resolveCallerScope(req);
    const hash = sha256Hex(data.content_md);

    const result = await withOrgScope(scope.org_id, async (client) => {
      // Dedupe pass: same hash already in this org?
      const { rows: existing } = await client.query<DocRow>(
        `SELECT ${DOC_COLUMNS} FROM ops.document WHERE org_id = $1 AND content_hash = $2`,
        [scope.org_id, hash],
      );
      if (existing.length > 0 && !data.force) {
        return { kind: "duplicate" as const, document: existing[0]! };
      }
      // Force: delete prior doc + chunks (cascade), re-ingest below.
      if (existing.length > 0 && data.force) {
        await client.query("DELETE FROM ops.document WHERE id = $1", [existing[0]!.id]);
      }

      const chunks = chunkText(data.content_md, {
        targetChars: data.target_chars,
        overlapChars: data.overlap_chars,
        minChars: data.min_chars,
      });

      const { rows: docRows } = await client.query<DocRow>(
        `INSERT INTO ops.document (
            org_id, scope, title, source_url, source_filename, mime_type,
            content_hash, tags, char_count, chunk_count
         )
         VALUES ($1, $2::ops.skill_scope, $3, $4, $5, $6,
                 $7, $8::text[], $9, $10)
         RETURNING ${DOC_COLUMNS}`,
        [
          scope.org_id,
          data.scope,
          data.title,
          data.source_url ?? null,
          data.source_filename ?? null,
          data.mime_type,
          hash,
          data.tags,
          data.content_md.length,
          chunks.length,
        ],
      );
      const doc = docRows[0]!;

      for (const c of chunks) {
        await client.query(
          `INSERT INTO ops.document_chunk
              (document_id, org_id, chunk_index, total_chunks, text, char_start, char_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [doc.id, scope.org_id, c.index, c.total, c.text, c.char_start, c.char_end],
        );
      }

      await audit(
        {
          scope,
          action: data.force && existing.length > 0 ? "document.replace" : "document.ingest",
          target_type: "document",
          target_id: doc.id,
          metadata: {
            title: doc.title,
            source_url: doc.source_url,
            source_filename: doc.source_filename,
            chunk_count: doc.chunk_count,
            char_count: doc.char_count,
            scope: doc.scope,
            replaced: data.force && existing.length > 0,
          },
        },
        client,
      );
      return { kind: "ok" as const, document: doc };
    });

    if (result.kind === "duplicate") {
      return reply.code(200).send({
        document_id: result.document.id,
        chunk_count: result.document.chunk_count,
        deduplicated: true,
        document: result.document,
      });
    }
    return reply.code(201).send({
      document_id: result.document.id,
      chunk_count: result.document.chunk_count,
      deduplicated: false,
      document: result.document,
    });
  });

  // -- list --------------------------------------------------------------
  app.get<{ Querystring: { scope?: string; tag?: string; limit?: string } }>(
    "/api/documents",
    async (req) => {
      const scope = await resolveCallerScope(req);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
      const where: string[] = ["org_id = $1"];
      const params: unknown[] = [scope.org_id];
      if (req.query.scope) {
        params.push(req.query.scope);
        where.push(`scope = $${params.length}::ops.skill_scope`);
      }
      if (req.query.tag) {
        params.push(req.query.tag);
        where.push(`$${params.length} = ANY(tags)`);
      }
      params.push(limit);
      return withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<DocRow>(
          `SELECT ${DOC_COLUMNS} FROM ops.document
            WHERE ${where.join(" AND ")}
            ORDER BY ingested_at DESC
            LIMIT $${params.length}`,
          params,
        );
        return rows;
      });
    },
  );

  // -- search across chunks (keyword) ------------------------------------
  // Defined BEFORE /:id so static-segment matching wins over the param.
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    "/api/documents/search",
    async (req, reply) => {
      const q = (req.query.q ?? "").trim();
      if (q.length < 2) return reply.code(400).send({ error: "q must be ≥ 2 chars" });
      const scope = await resolveCallerScope(req);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
      const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      return withOrgScope(scope.org_id, async (client) => {
        // Join chunks → document so the operator sees the title context.
        const { rows } = await client.query<{
          chunk_id: string;
          document_id: string;
          chunk_index: number;
          total_chunks: number;
          text: string;
          char_start: number;
          char_end: number;
          title: string;
          source_url: string | null;
          source_filename: string | null;
          ingested_at: string;
        }>(
          `SELECT c.id AS chunk_id, c.document_id, c.chunk_index, c.total_chunks,
                  c.text, c.char_start, c.char_end,
                  d.title, d.source_url, d.source_filename, d.ingested_at
             FROM ops.document_chunk c
             JOIN ops.document d ON d.id = c.document_id
            WHERE c.org_id = $1 AND c.text ILIKE $2
            ORDER BY d.ingested_at DESC, c.chunk_index ASC
            LIMIT $3`,
          [scope.org_id, like, limit],
        );
        return rows;
      });
    },
  );

  // -- get one + its chunks ----------------------------------------------
  app.get<{ Params: { id: string } }>("/api/documents/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const doc = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<DocRow>(
        `SELECT ${DOC_COLUMNS} FROM ops.document WHERE id = $1 AND org_id = $2`,
        [req.params.id, scope.org_id],
      );
      return rows[0] ?? null;
    });
    if (!doc) return reply.code(404).send({ error: "not_found" });
    return doc;
  });

  app.get<{ Params: { id: string } }>(
    "/api/documents/:id/chunks",
    async (req, reply) => {
      const scope = await resolveCallerScope(req);
      const result = await withOrgScope(scope.org_id, async (client) => {
        const { rows: own } = await client.query<{ id: string }>(
          "SELECT id FROM ops.document WHERE id = $1 AND org_id = $2",
          [req.params.id, scope.org_id],
        );
        if (own.length === 0) return null;
        const { rows } = await client.query<ChunkRow>(
          `SELECT ${CHUNK_COLUMNS} FROM ops.document_chunk
            WHERE document_id = $1 AND org_id = $2
            ORDER BY chunk_index ASC`,
          [req.params.id, scope.org_id],
        );
        return rows;
      });
      if (!result) return reply.code(404).send({ error: "not_found" });
      return result;
    },
  );

  // -- delete -------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/api/documents/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<{
        id: string;
        title: string;
        chunk_count: number;
      }>(
        `DELETE FROM ops.document
          WHERE id = $1 AND org_id = $2
          RETURNING id, title, chunk_count`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      await audit(
        {
          scope,
          action: "document.delete",
          target_type: "document",
          target_id: rows[0]!.id,
          metadata: {
            title: rows[0]!.title,
            chunk_count: rows[0]!.chunk_count,
          },
        },
        client,
      );
      return rows[0];
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
