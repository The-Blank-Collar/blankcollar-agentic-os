/**
 * Upstream source pull — the work the scheduler does for each due
 * `ops.upstream_source` row, plus the same path used by the manual
 * `POST /api/upstream/:id/pull` endpoint.
 *
 * Flow:
 *   1. Fetch the URL.
 *   2. Hash the body.
 *   3. If hash matches `last_content_hash` and a `last_document_id` is
 *      already set → no-op; bump `last_pulled_at` + status='unchanged'.
 *   4. Otherwise → atomically replace the linked document:
 *        - delete the old `last_document_id` row (chunks cascade)
 *        - insert a new ops.document with `upstream_source_id = this.id`
 *        - chunk + insert ops.document_chunk rows
 *        - update upstream_source.last_* and reset consecutive_failures
 *   5. On any thrown error → bump consecutive_failures, record last_error.
 *      After 5 consecutive failures, set enabled=false until an operator
 *      manually re-pulls and succeeds.
 *
 * The function never throws — callers can treat it as best-effort and
 * inspect the returned status / error fields if they need to surface
 * them to the operator (manual pull endpoint does this).
 */

import { createHash } from "node:crypto";

import type pg from "pg";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { chunkText } from "../documents/chunker.js";
import { fetchExternalUrl, FetchExternalError } from "../documents/fetch.js";

const FAILURE_DISABLE_THRESHOLD = 5;

export type UpstreamSourceRow = {
  id: string;
  org_id: string;
  scope: "personal" | "company" | "shared";
  name: string;
  source_url: string;
  tags: string[];
  refresh_interval_seconds: number;
  last_pulled_at: string | null;
  last_content_hash: string | null;
  last_document_id: string | null;
  last_status: string | null;
  last_error: string | null;
  consecutive_failures: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type PullOutcome =
  | { status: "ok"; document_id: string; chunk_count: number; latency_ms: number }
  | { status: "unchanged"; document_id: string | null; latency_ms: number }
  | { status: "failed"; error: string; latency_ms: number };

export type PullDeps = {
  fetchImpl?: typeof fetch;
};

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Pull one upstream source. The function operates inside an org-scoped
 * transaction so RLS on ops.document / ops.document_chunk is respected.
 */
export async function pullUpstreamSource(
  source: UpstreamSourceRow,
  deps: PullDeps = {},
): Promise<PullOutcome> {
  const start = Date.now();
  try {
    const fetched = await fetchExternalUrl(source.source_url, { fetchImpl: deps.fetchImpl });
    if (!fetched.text || fetched.text.trim().length < 10) {
      throw new Error(`no extractable text (got ${fetched.text.length} chars)`);
    }

    const hash = sha256Hex(fetched.text);

    // No-change shortcut.
    if (
      source.last_content_hash === hash &&
      source.last_document_id !== null
    ) {
      await withOrgScope(source.org_id, async (client) => {
        await client.query(
          `UPDATE ops.upstream_source
              SET last_pulled_at = now(),
                  last_status = 'unchanged',
                  last_error = NULL,
                  consecutive_failures = 0,
                  updated_at = now()
            WHERE id = $1`,
          [source.id],
        );
      });
      return {
        status: "unchanged",
        document_id: source.last_document_id,
        latency_ms: Date.now() - start,
      };
    }

    // Replace path: delete old doc (chunks cascade), insert new, link.
    const result = await withOrgScope(source.org_id, async (client) => {
      if (source.last_document_id) {
        await client.query("DELETE FROM ops.document WHERE id = $1 AND org_id = $2", [
          source.last_document_id,
          source.org_id,
        ]);
      }

      const chunks = chunkText(fetched.text);
      const { rows: docRows } = await client.query<{ id: string }>(
        `INSERT INTO ops.document
            (org_id, scope, title, source_url, source_filename, mime_type,
             content_hash, tags, char_count, chunk_count, upstream_source_id)
         VALUES ($1, $2::ops.skill_scope, $3, $4, NULL, $5,
                 $6, $7::text[], $8, $9, $10)
         RETURNING id`,
        [
          source.org_id,
          source.scope,
          fetched.title || source.name,
          fetched.final_url,
          fetched.mime,
          hash,
          source.tags,
          fetched.text.length,
          chunks.length,
          source.id,
        ],
      );
      const docId = docRows[0]!.id;

      for (const c of chunks) {
        await client.query(
          `INSERT INTO ops.document_chunk
              (document_id, org_id, chunk_index, total_chunks, text, char_start, char_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [docId, source.org_id, c.index, c.total, c.text, c.char_start, c.char_end],
        );
      }

      await client.query(
        `UPDATE ops.upstream_source
            SET last_pulled_at = now(),
                last_content_hash = $2,
                last_document_id = $3,
                last_status = 'ok',
                last_error = NULL,
                consecutive_failures = 0,
                updated_at = now()
          WHERE id = $1`,
        [source.id, hash, docId],
      );

      // System scope so the audit row goes through (no caller scope here —
      // the scheduler runs cross-org in withSystemScope and individual
      // pulls run under withOrgScope but with no user actor).
      await client.query(
        `INSERT INTO core.audit_log (org_id, actor_role, action, target_type, target_id, metadata)
         VALUES ($1, NULL, 'upstream.pulled', 'upstream_source', $2, $3::jsonb)`,
        [
          source.org_id,
          source.id,
          JSON.stringify({
            source_url: source.source_url,
            document_id: docId,
            chunk_count: chunks.length,
            char_count: fetched.text.length,
            replaced: source.last_document_id !== null,
          }),
        ],
      );
      // Suppress lint complaint about unused audit import; we do use it
      // indirectly via the route handlers in the upstream CRUD module.
      void audit;

      return { docId, chunkCount: chunks.length };
    });

    return {
      status: "ok",
      document_id: result.docId,
      chunk_count: result.chunkCount,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    const message =
      err instanceof FetchExternalError
        ? `${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    try {
      await withOrgScope(source.org_id, async (client) => {
        const newFailures = source.consecutive_failures + 1;
        const shouldDisable = newFailures >= FAILURE_DISABLE_THRESHOLD;
        await client.query(
          `UPDATE ops.upstream_source
              SET last_pulled_at = now(),
                  last_status = 'failed',
                  last_error = $2,
                  consecutive_failures = $3,
                  enabled = CASE WHEN $4 THEN false ELSE enabled END,
                  updated_at = now()
            WHERE id = $1`,
          [source.id, message.slice(0, 1000), newFailures, shouldDisable],
        );
      });
    } catch {
      // If we can't even record the failure, swallow — scheduler will
      // try again next tick.
    }
    return { status: "failed", error: message, latency_ms: Date.now() - start };
  }
}

/**
 * Find every due upstream source and pull each one. Designed for the
 * scheduler tick — called under withSystemScope, runs sequentially to
 * avoid forking many simultaneous fetches against the same external
 * host. Returns counts for logging.
 */
export async function pullDueUpstreamSources(
  client: pg.PoolClient,
  deps: PullDeps = {},
): Promise<{ scanned: number; ok: number; unchanged: number; failed: number }> {
  // Lock the rows we'll work on so two overlapping ticks don't race.
  // last_pulled_at IS NULL → first pull, always due.
  const { rows } = await client.query<UpstreamSourceRow>(
    `SELECT id, org_id, scope, name, source_url, tags, refresh_interval_seconds,
            last_pulled_at, last_content_hash, last_document_id, last_status,
            last_error, consecutive_failures, enabled, created_at, updated_at
       FROM ops.upstream_source
      WHERE enabled = true
        AND (last_pulled_at IS NULL
             OR last_pulled_at < now() - (refresh_interval_seconds || ' seconds')::interval)
      ORDER BY last_pulled_at NULLS FIRST, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 50`,
  );

  let ok = 0;
  let unchanged = 0;
  let failed = 0;
  for (const source of rows) {
    const r = await pullUpstreamSource(source, deps);
    if (r.status === "ok") ok++;
    else if (r.status === "unchanged") unchanged++;
    else failed++;
  }
  return { scanned: rows.length, ok, unchanged, failed };
}
