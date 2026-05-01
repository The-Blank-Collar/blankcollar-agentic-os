/**
 * Cross-corpus search.
 *
 * One endpoint, four corpora — goals / captures / knowledge / agents — for
 * the ⌘K palette and the `bc search` CLI. v0 is ILIKE-based; the data
 * sizes per org are small enough that a tsvector + GIN index would be
 * over-engineering. When a corpus crosses 10k rows we'll switch to
 * `to_tsvector('english', …)` per-table.
 *
 *   GET /api/search?q=lark&kind=all&limit=20
 *
 * `kind` filters to one corpus (goals|captures|knowledge|agents); the
 * default `all` returns up to `limit` hits per kind, interleaved by score.
 */

import type { FastifyInstance } from "fastify";

import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";

export type SearchKind = "goal" | "capture" | "knowledge" | "agent";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string | null;
  score: number;
  created_at: string;
  metadata: Record<string, unknown>;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SNIPPET_LEN = 140;

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string; kind?: string; limit?: string } }>(
    "/api/search",
    async (req, reply) => {
      const q = (req.query.q ?? "").trim();
      if (q.length < 2) return reply.code(400).send({ error: "q must be ≥ 2 chars" });

      const kind = (req.query.kind ?? "all") as "all" | SearchKind;
      const limit = Math.min(Math.max(Number(req.query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
      const scope = await resolveCallerScope(req);
      const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

      return withOrgScope(scope.org_id, async (client) => {
        const hits: SearchHit[] = [];

        if (kind === "all" || kind === "goal") {
          const { rows } = await client.query<{
            id: string;
            title: string;
            description: string | null;
            kind: string;
            status: string;
            created_at: string;
          }>(
            `SELECT id, title, description, kind, status, created_at
               FROM ops.goal
              WHERE org_id = $1
                AND (title ILIKE $2 OR description ILIKE $2)
              ORDER BY created_at DESC
              LIMIT $3`,
            [scope.org_id, like, limit],
          );
          for (const r of rows) {
            hits.push({
              kind: "goal",
              id: r.id,
              title: r.title,
              snippet: snippet(r.description, q),
              score: scoreOf(r.title, r.description, q),
              created_at: r.created_at,
              metadata: { goal_kind: r.kind, status: r.status },
            });
          }
        }

        if (kind === "all" || kind === "capture") {
          const { rows } = await client.query<{
            id: string;
            raw_content: string;
            source: string;
            created_at: string;
            resolved_to_id: string | null;
            resolved_kind: string | null;
          }>(
            `SELECT id, raw_content, source, created_at, resolved_to_id, resolved_kind
               FROM ops.capture
              WHERE org_id = $1 AND raw_content ILIKE $2
              ORDER BY created_at DESC
              LIMIT $3`,
            [scope.org_id, like, limit],
          );
          for (const r of rows) {
            const head = r.raw_content.slice(0, 80);
            hits.push({
              kind: "capture",
              id: r.id,
              title: head,
              snippet: snippet(r.raw_content, q),
              score: scoreOf(head, r.raw_content, q),
              created_at: r.created_at,
              metadata: {
                source: r.source,
                resolved_to_id: r.resolved_to_id,
                resolved_kind: r.resolved_kind,
              },
            });
          }
        }

        if (kind === "all" || kind === "knowledge") {
          const { rows } = await client.query<{
            id: string;
            slug: string;
            title: string;
            content_md: string;
            scope: string;
            tags: string[];
            updated_at: string;
            created_at: string;
          }>(
            `SELECT id, slug, title, content_md, scope, tags, updated_at, created_at
               FROM ops.knowledge_doc
              WHERE org_id = $1
                AND (title ILIKE $2 OR content_md ILIKE $2 OR slug ILIKE $2)
              ORDER BY updated_at DESC
              LIMIT $3`,
            [scope.org_id, like, limit],
          );
          for (const r of rows) {
            hits.push({
              kind: "knowledge",
              id: r.id,
              title: r.title,
              snippet: snippet(r.content_md, q),
              score: scoreOf(r.title, r.content_md, q),
              created_at: r.created_at,
              metadata: { slug: r.slug, scope: r.scope, tags: r.tags },
            });
          }
        }

        if (kind === "all" || kind === "agent") {
          const { rows } = await client.query<{
            id: string;
            name: string;
            kind: string;
            is_active: boolean;
            created_at: string;
          }>(
            `SELECT id, name, kind, is_active, created_at
               FROM ops.agent
              WHERE org_id = $1 AND (name ILIKE $2 OR kind ILIKE $2)
              ORDER BY is_active DESC, created_at DESC
              LIMIT $3`,
            [scope.org_id, like, limit],
          );
          for (const r of rows) {
            hits.push({
              kind: "agent",
              id: r.id,
              title: r.name,
              snippet: r.kind,
              score: scoreOf(r.name, r.kind, q),
              created_at: r.created_at,
              metadata: { agent_kind: r.kind, is_active: r.is_active },
            });
          }
        }

        hits.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.created_at < b.created_at ? 1 : -1;
        });
        return hits.slice(0, limit);
      });
    },
  );
}

/**
 * Score = (title-match ? 10 : 0) + (body-match ? 1 : 0) + recency-decay.
 * Title hits beat body hits; ties broken by recency in the sort step.
 */
export function scoreOf(title: string | null, body: string | null, q: string): number {
  const lq = q.toLowerCase();
  let s = 0;
  if (title && title.toLowerCase().includes(lq)) s += 10;
  if (body && body.toLowerCase().includes(lq)) s += 1;
  return s;
}

/**
 * Trim a snippet around the first match, ~SNIPPET_LEN chars wide. If the
 * match is at the head, snippet is the prefix; otherwise we slide a window.
 */
export function snippet(text: string | null, q: string): string | null {
  if (!text) return null;
  const lq = q.toLowerCase();
  const lt = text.toLowerCase();
  const idx = lt.indexOf(lq);
  if (idx === -1) return text.slice(0, SNIPPET_LEN);
  const radius = Math.floor((SNIPPET_LEN - q.length) / 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + q.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end) + suffix;
}
