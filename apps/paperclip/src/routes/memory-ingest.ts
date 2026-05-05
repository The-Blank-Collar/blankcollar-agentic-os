/**
 * Web ingest — Phase 9.5.
 *
 * One-shot URL → memory pipeline. Drop a URL, we fetch it via the
 * existing fetchExternalUrl() (Sprint 2.5), extract text, and write
 * a single brain.memory row of kind=document scoped to the caller's
 * org (and optionally a goal). The next agent run can recall it.
 *
 * Lean by design — reuses everything:
 *   - Sprint 2.5's HTML→text fetcher (apps/paperclip/src/documents/fetch.ts)
 *   - brain.memory table (no new schema)
 *   - withOrgScope + audit (no new helpers)
 *
 * Capped at 16k chars per ingest so a chatty article doesn't bloat
 * the brain. Truncation is signalled in the response.
 *
 *   POST /api/memory/ingest-url
 *     { url, title?, goal_id?, tags? }
 *   → 201 { memory_id, title, length, truncated }
 */

import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { fetchExternalUrl, FetchExternalError } from "../documents/fetch.js";
import { resolveCallerScope } from "../scope.js";

const MAX_CHARS = 16_000;

const IngestUrlBody = z
  .object({
    url: z.string().url().max(2048),
    title: z.string().max(200).optional(),
    goal_id: z.string().uuid().optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
  })
  .strict();

export async function memoryIngestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/memory/ingest-url", async (req, reply) => {
    const parsed = IngestUrlBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);

    let fetched;
    try {
      fetched = await fetchExternalUrl(parsed.data.url);
    } catch (err) {
      const status = err instanceof FetchExternalError ? err.status : 0;
      return reply.code(502).send({
        error: "fetch_failed",
        url: parsed.data.url,
        upstream_status: status,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    const text = fetched.text.trim();
    if (text.length === 0) {
      return reply.code(422).send({
        error: "no_extractable_text",
        url: parsed.data.url,
        hint: "Page returned no parseable text — JavaScript-rendered or media-only.",
      });
    }

    const truncated = text.length > MAX_CHARS;
    const content = truncated ? text.slice(0, MAX_CHARS - 1) + "…" : text;
    const title = (parsed.data.title?.trim() || fetched.title || parsed.data.url).slice(0, 200);
    const contentHash = createHash("sha256").update(content).digest("hex");
    const fetchedAt = new Date().toISOString();

    return withOrgScope(scope.org_id, async (client) => {
      // If a goal_id is given, verify it belongs to this org. Cheap;
      // gives a clean 404 instead of falling into RLS oblivion.
      if (parsed.data.goal_id) {
        const { rows: own } = await client.query<{ id: string }>(
          "SELECT id FROM ops.goal WHERE id = $1 AND org_id = $2",
          [parsed.data.goal_id, scope.org_id],
        );
        if (own.length === 0) {
          return reply.code(404).send({ error: "goal_not_found" });
        }
      }

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO brain.memory
           (org_id, goal_id, kind, title, content, metadata)
         VALUES (
           current_setting('app.org_id', true)::uuid,
           $1, 'document'::brain.memory_kind, $2, $3, $4::jsonb
         )
         RETURNING id::text`,
        [
          parsed.data.goal_id ?? null,
          title,
          content,
          JSON.stringify({
            source: "web_ingest",
            url: parsed.data.url,
            final_url: fetched.final_url,
            fetched_at: fetchedAt,
            content_hash: contentHash,
            mime: fetched.mime,
            tags: parsed.data.tags ?? [],
            truncated,
          }),
        ],
      );

      const memoryId = rows[0]!.id;
      await audit(
        {
          scope,
          action: "memory.web_ingest",
          target_type: "memory",
          target_id: memoryId,
          metadata: {
            url: parsed.data.url,
            title,
            length: content.length,
            truncated,
            goal_id: parsed.data.goal_id ?? null,
          },
        },
        client,
      );

      return reply.code(201).send({
        memory_id: memoryId,
        title,
        length: content.length,
        truncated,
        url: parsed.data.url,
      });
    });
  });
}
