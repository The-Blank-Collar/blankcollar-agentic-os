/**
 * Knowledge wiki API.
 *
 *   GET    /api/knowledge                    list docs (filter by scope, hot, tag, q)
 *   GET    /api/knowledge/hot                hot-context docs (always pre-loaded for Hermes)
 *   GET    /api/knowledge/:slug              single doc + backlinks + outbound links
 *   POST   /api/knowledge                    create
 *   PATCH  /api/knowledge/:id                update
 *   DELETE /api/knowledge/:id                delete (cascades to links)
 *
 * Each write rebuilds the outbound `[[wikilink]]` graph for the doc and
 * pushes the markdown into gbrain as a `document` memory so semantic
 * recall finds it alongside other context.
 */

import type { FastifyInstance } from "fastify";
import type pg from "pg";

import { audit } from "../audit.js";
import { query, tx } from "../db.js";
import { extractWikilinks, pushDocToBrain } from "../knowledge/wiki.js";
import { resolveCallerScope } from "../scope.js";
import { KnowledgeDocCreate, KnowledgeDocPatch, KnowledgeListQuery } from "../schemas.js";

type DocRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  slug: string;
  title: string;
  scope: "personal" | "company" | "shared";
  hot: boolean;
  content_md: string;
  tags: string[];
  memory_id: string | null;
  created_at: string;
  updated_at: string;
};

const DOC_COLUMNS = "id, org_id, user_id, slug, title, scope, hot, content_md, tags, memory_id, created_at, updated_at";

async function rebuildLinks(client: pg.PoolClient, docId: string, md: string, orgId: string): Promise<void> {
  await client.query("DELETE FROM ops.knowledge_link WHERE from_doc_id = $1", [docId]);
  const links = extractWikilinks(md);
  for (const l of links) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM ops.knowledge_doc
        WHERE slug = $1 AND (org_id = $2 OR scope = 'shared') LIMIT 1`,
      [l.slug, orgId],
    );
    if (rows.length === 0) continue;
    await client.query(
      `INSERT INTO ops.knowledge_link (from_doc_id, to_doc_id, anchor)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [docId, rows[0]!.id, l.anchor],
    );
  }
}

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  // -- list ---------------------------------------------------------------
  app.get("/api/knowledge", async (req, reply) => {
    const parsed = KnowledgeListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const where: string[] = ["(scope = 'shared' OR org_id = $1)"];
    const params: unknown[] = [scope.org_id];
    if (parsed.data.scope) {
      params.push(parsed.data.scope);
      where.push(`scope = $${params.length}::ops.knowledge_scope`);
    }
    if (parsed.data.hot !== undefined) {
      params.push(parsed.data.hot);
      where.push(`hot = $${params.length}`);
    }
    if (parsed.data.tag) {
      params.push(parsed.data.tag);
      where.push(`$${params.length} = ANY(tags)`);
    }
    if (parsed.data.q) {
      params.push(`%${parsed.data.q}%`);
      where.push(`(title ILIKE $${params.length} OR content_md ILIKE $${params.length})`);
    }
    params.push(parsed.data.limit);
    const { rows } = await query<DocRow>(
      `SELECT ${DOC_COLUMNS} FROM ops.knowledge_doc
        WHERE ${where.join(" AND ")}
        ORDER BY hot DESC, updated_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return rows;
  });

  // -- hot context (used by Hermes) ---------------------------------------
  app.get("/api/knowledge/hot", async (req) => {
    const scope = await resolveCallerScope(req);
    const { rows } = await query<DocRow>(
      `SELECT ${DOC_COLUMNS} FROM ops.knowledge_doc
        WHERE hot = true AND (scope = 'shared' OR org_id = $1)
        ORDER BY scope, updated_at DESC`,
      [scope.org_id],
    );
    return rows;
  });

  // -- get one + neighbours ----------------------------------------------
  app.get<{ Params: { slug: string } }>("/api/knowledge/:slug", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const { rows } = await query<DocRow>(
      `SELECT ${DOC_COLUMNS} FROM ops.knowledge_doc
        WHERE slug = $1 AND (scope = 'shared' OR org_id = $2)
        ORDER BY scope DESC LIMIT 1`,
      [req.params.slug, scope.org_id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    const doc = rows[0]!;

    const [outbound, inbound] = await Promise.all([
      query<{ slug: string; title: string; anchor: string | null }>(
        `SELECT d.slug, d.title, l.anchor
           FROM ops.knowledge_link l
           JOIN ops.knowledge_doc d ON d.id = l.to_doc_id
          WHERE l.from_doc_id = $1`,
        [doc.id],
      ),
      query<{ slug: string; title: string }>(
        `SELECT d.slug, d.title
           FROM ops.knowledge_link l
           JOIN ops.knowledge_doc d ON d.id = l.from_doc_id
          WHERE l.to_doc_id = $1`,
        [doc.id],
      ),
    ]);

    return {
      ...doc,
      outbound_links: outbound.rows,
      backlinks: inbound.rows,
    };
  });

  // -- create -------------------------------------------------------------
  app.post("/api/knowledge", async (req, reply) => {
    const parsed = KnowledgeDocCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const result = await tx(async (client) => {
      const { rows } = await client.query<DocRow>(
        `INSERT INTO ops.knowledge_doc (org_id, slug, title, scope, hot, content_md, tags)
         VALUES ($1, $2, $3, $4::ops.knowledge_scope, $5, $6, $7)
         RETURNING ${DOC_COLUMNS}`,
        [
          scope.org_id,
          parsed.data.slug,
          parsed.data.title,
          parsed.data.scope,
          parsed.data.hot,
          parsed.data.content_md,
          parsed.data.tags,
        ],
      );
      const doc = rows[0]!;
      await rebuildLinks(client, doc.id, doc.content_md, doc.org_id);
      await audit(
        {
          scope,
          action: "knowledge.create",
          target_type: "knowledge_doc",
          target_id: doc.id,
          metadata: { slug: doc.slug, scope: doc.scope, hot: doc.hot },
        },
        client,
      );
      return doc;
    });

    // Push to gbrain after the tx commits so a brain failure can't roll back the doc.
    const memoryId = await pushDocToBrain({
      orgId: result.org_id,
      scope: result.scope,
      title: result.title,
      content: result.content_md,
      tags: result.tags,
    });
    if (memoryId) {
      await query(`UPDATE ops.knowledge_doc SET memory_id = $1 WHERE id = $2`, [memoryId, result.id]);
    }
    return reply.code(201).send({ ...result, memory_id: memoryId });
  });

  // -- patch --------------------------------------------------------------
  app.patch<{ Params: { id: string } }>("/api/knowledge/:id", async (req, reply) => {
    const parsed = KnowledgeDocPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const sets: string[] = [];
    const params: unknown[] = [req.params.id, scope.org_id];
    if (parsed.data.title !== undefined)      { params.push(parsed.data.title);    sets.push(`title = $${params.length}`); }
    if (parsed.data.scope !== undefined)      { params.push(parsed.data.scope);    sets.push(`scope = $${params.length}::ops.knowledge_scope`); }
    if (parsed.data.hot !== undefined)        { params.push(parsed.data.hot);      sets.push(`hot = $${params.length}`); }
    if (parsed.data.content_md !== undefined) { params.push(parsed.data.content_md); sets.push(`content_md = $${params.length}`); }
    if (parsed.data.tags !== undefined)       { params.push(parsed.data.tags);     sets.push(`tags = $${params.length}`); }
    if (sets.length === 0) return reply.code(400).send({ error: "no_changes" });
    sets.push("updated_at = now()");

    const result = await tx(async (client) => {
      const { rows } = await client.query<DocRow>(
        `UPDATE ops.knowledge_doc
            SET ${sets.join(", ")}
          WHERE id = $1 AND org_id = $2
          RETURNING ${DOC_COLUMNS}`,
        params,
      );
      if (rows.length === 0) return undefined;
      const doc = rows[0]!;
      // Re-extract backlinks if content changed.
      if (parsed.data.content_md !== undefined) {
        await rebuildLinks(client, doc.id, doc.content_md, doc.org_id);
      }
      await audit(
        {
          scope,
          action: "knowledge.update",
          target_type: "knowledge_doc",
          target_id: doc.id,
          metadata: parsed.data,
        },
        client,
      );
      return doc;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });

    if (parsed.data.content_md !== undefined) {
      const memoryId = await pushDocToBrain({
        orgId: result.org_id,
        scope: result.scope,
        title: result.title,
        content: result.content_md,
        tags: result.tags,
      });
      if (memoryId) {
        await query(`UPDATE ops.knowledge_doc SET memory_id = $1 WHERE id = $2`, [memoryId, result.id]);
      }
    }
    return result;
  });

  // -- delete -------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/api/knowledge/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await tx(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `DELETE FROM ops.knowledge_doc
          WHERE id = $1 AND org_id = $2
          RETURNING id`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      await audit(
        {
          scope,
          action: "knowledge.delete",
          target_type: "knowledge_doc",
          target_id: rows[0]!.id,
        },
        client,
      );
      return rows[0]!.id;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
