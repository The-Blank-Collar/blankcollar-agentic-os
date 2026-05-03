/**
 * Skill drafts — LLM-extracted skill candidates from `ops.document` SOPs.
 *
 *   POST   /api/documents/:id/draft-skill   trigger extraction (sync v1)
 *   GET    /api/skill-drafts                list (filter by status)
 *   GET    /api/skill-drafts/:id            fetch one
 *   PATCH  /api/skill-drafts/:id            edit before promotion
 *   POST   /api/skill-drafts/:id/promote    write to ops.skill
 *   POST   /api/skill-drafts/:id/reject     soft-delete (status='rejected')
 *
 * Promotion writes a new ops.skill row at scope='company', org_id=caller's
 * org. The new skill is `enabled=true` immediately — operators who want a
 * dry-run path should test in simulation mode (Sprint 2.3) before flipping
 * the ASK→AUTO autonomy mode (Sprint 5.1).
 *
 * Drafts and skills are linked both ways:
 *   - skill_draft.source_document_id  → ops.document.id
 *   - skill.source_document_id        → ops.document.id (set on promote)
 *   - skill_draft.promoted_skill_id   → ops.skill.id    (set on promote)
 *
 * Re-running extraction on the same document creates a NEW draft row (we
 * never overwrite history). Operators see version progression in the
 * Skills tab.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import { extractSkillDraft, type SkillStep } from "../skills/extract.js";
import { SkillDraftListQuery, SkillDraftPatch } from "../schemas.js";

type DraftRow = {
  id: string;
  org_id: string;
  source_document_id: string | null;
  title: string;
  description: string | null;
  agent_kind: string;
  proposed_slug: string;
  steps: SkillStep[];
  inferred_tools: string[];
  params_schema: Record<string, unknown>;
  status: "draft" | "promoted" | "rejected";
  promoted_skill_id: string | null;
  warnings: string[];
  llm_provider: string | null;
  llm_model: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS = `
  id, org_id, source_document_id, title, description, agent_kind, proposed_slug,
  steps, inferred_tools, params_schema, status, promoted_skill_id, warnings,
  llm_provider, llm_model, created_at, updated_at
`;

export async function skillDraftRoutes(app: FastifyInstance): Promise<void> {
  // -- generate from a document ------------------------------------------
  // The document is loaded inside the same withOrgScope so RLS still applies.
  // The LLM call happens between the two queries — safe because nothing
  // mutates between them; the second query is just an INSERT.
  app.post<{ Params: { id: string } }>("/api/documents/:id/draft-skill", async (req, reply) => {
    const scope = await resolveCallerScope(req);

    // 1. Load document + the registry of available tools/skills so the
    //    extractor can ground inferred_tools in real slugs.
    const ctx = await withOrgScope(scope.org_id, async (client) => {
      const { rows: docRows } = await client.query<{
        id: string;
        title: string;
        content_md: string;
      }>(
        `SELECT id, title, content_md FROM ops.document WHERE id = $1 AND org_id = $2`,
        [req.params.id, scope.org_id],
      );
      if (docRows.length === 0) return null;

      const { rows: tools } = await client.query<{
        slug: string;
        description: string | null;
        agent_kind: string;
      }>(
        `SELECT slug, description, agent_kind
           FROM ops.skill
          WHERE (org_id IS NULL OR org_id = $1) AND enabled = true
          ORDER BY slug ASC LIMIT 100`,
        [scope.org_id],
      );
      return { doc: docRows[0]!, tools };
    });
    if (!ctx) return reply.code(404).send({ error: "document_not_found" });

    // 2. Run the extractor. Falls back to deterministic parser if Portkey
    //    isn't configured.
    const fields = await extractSkillDraft({
      content_md: ctx.doc.content_md,
      title_hint: ctx.doc.title,
      registry: ctx.tools,
    });

    // 3. Persist as a draft.
    const row = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<DraftRow>(
        `INSERT INTO ops.skill_draft
           (org_id, source_document_id, title, description, agent_kind,
            proposed_slug, steps, inferred_tools, params_schema, warnings,
            llm_provider, llm_model)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb,
                 $10::jsonb, $11, $12)
         RETURNING ${COLUMNS}`,
        [
          scope.org_id,
          ctx.doc.id,
          fields.title,
          fields.description || null,
          fields.agent_kind,
          fields.proposed_slug,
          JSON.stringify(fields.steps),
          JSON.stringify(fields.inferred_tools),
          JSON.stringify(fields.params_schema),
          JSON.stringify(fields.warnings),
          fields.llm_provider,
          fields.llm_model,
        ],
      );
      const draft = rows[0]!;
      await audit(
        {
          scope,
          action: "skill_draft.create",
          target_type: "skill_draft",
          target_id: draft.id,
          metadata: {
            source_document_id: ctx.doc.id,
            llm_provider: fields.llm_provider,
            llm_model: fields.llm_model,
            steps: fields.steps.length,
            warnings: fields.warnings.length,
          },
        },
        client,
      );
      return draft;
    });
    return reply.code(201).send(row);
  });

  // -- list --------------------------------------------------------------
  app.get("/api/skill-drafts", async (req, reply) => {
    const parsed = SkillDraftListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const where: string[] = ["org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (parsed.data.status) {
      params.push(parsed.data.status);
      where.push(`status = $${params.length}`);
    }
    params.push(parsed.data.limit);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<DraftRow>(
        `SELECT ${COLUMNS}
           FROM ops.skill_draft
          WHERE ${where.join(" AND ")}
          ORDER BY updated_at DESC
          LIMIT $${params.length}`,
        params,
      );
      return rows;
    });
  });

  // -- get one -----------------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/skill-drafts/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const rows = await withOrgScope(scope.org_id, async (client) => {
      const { rows: rs } = await client.query<DraftRow>(
        `SELECT ${COLUMNS} FROM ops.skill_draft WHERE id = $1 AND org_id = $2`,
        [req.params.id, scope.org_id],
      );
      return rs;
    });
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });

  // -- patch -------------------------------------------------------------
  app.patch<{ Params: { id: string } }>("/api/skill-drafts/:id", async (req, reply) => {
    const parsed = SkillDraftPatch.safeParse(req.body);
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
    if (parsed.data.title !== undefined)         setCol("title", parsed.data.title);
    if (parsed.data.description !== undefined)   setCol("description", parsed.data.description);
    if (parsed.data.agent_kind !== undefined)    setCol("agent_kind", parsed.data.agent_kind);
    if (parsed.data.proposed_slug !== undefined) setCol("proposed_slug", parsed.data.proposed_slug);
    if (parsed.data.steps !== undefined)         setCol("steps", JSON.stringify(parsed.data.steps), "::jsonb");
    if (parsed.data.inferred_tools !== undefined) setCol("inferred_tools", JSON.stringify(parsed.data.inferred_tools), "::jsonb");
    if (parsed.data.params_schema !== undefined) setCol("params_schema", JSON.stringify(parsed.data.params_schema), "::jsonb");
    if (sets.length === 0) return reply.code(400).send({ error: "no_changes" });
    sets.push("updated_at = now()");

    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<DraftRow>(
        `UPDATE ops.skill_draft SET ${sets.join(", ")}
          WHERE id = $1 AND org_id = $2 AND status = 'draft'
          RETURNING ${COLUMNS}`,
        params,
      );
      if (rows.length === 0) return undefined;
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "skill_draft.update",
          target_type: "skill_draft",
          target_id: row.id,
          metadata: { fields: Object.keys(parsed.data) },
        },
        client,
      );
      return row;
    });
    if (!result) {
      return reply.code(404).send({ error: "not_found_or_not_draft" });
    }
    return result;
  });

  // -- promote -----------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/api/skill-drafts/:id/promote",
    async (req, reply) => {
      const scope = await resolveCallerScope(req);
      const result = await withOrgScope(scope.org_id, async (client) => {
        const { rows: drafts } = await client.query<DraftRow>(
          `SELECT ${COLUMNS} FROM ops.skill_draft
            WHERE id = $1 AND org_id = $2 AND status = 'draft'
            FOR UPDATE`,
          [req.params.id, scope.org_id],
        );
        if (drafts.length === 0) return { kind: "not_found" as const };
        const draft = drafts[0]!;

        // Collision check: the slug must be free at this org's scope.
        const { rows: clash } = await client.query<{ id: string }>(
          `SELECT id FROM ops.skill
            WHERE slug = $1
              AND (org_id IS NULL OR org_id = $2)
            ORDER BY version DESC LIMIT 1`,
          [draft.proposed_slug, scope.org_id],
        );

        // If clash, bump version. New row inherits same slug, new version.
        const nextVersion =
          clash.length > 0
            ? // version column is integer; pull and add 1
              (
                await client.query<{ version: number }>(
                  `SELECT version FROM ops.skill WHERE id = $1`,
                  [clash[0]!.id],
                )
              ).rows[0]!.version + 1
            : 1;

        const { rows: skillRows } = await client.query<{ id: string; version: number }>(
          `INSERT INTO ops.skill
             (org_id, slug, version, scope, agent_kind, title, description,
              manifest_path, params_schema, side_effects, enabled,
              source_document_id)
           VALUES ($1, $2, $3, 'company'::ops.skill_scope, $4, $5, $6,
                   $7, $8::jsonb, 'read', true, $9)
           RETURNING id, version`,
          [
            scope.org_id,
            draft.proposed_slug,
            nextVersion,
            draft.agent_kind,
            draft.title,
            draft.description,
            `<generated from skill_draft ${draft.id}>`,
            JSON.stringify(draft.params_schema),
            draft.source_document_id,
          ],
        );
        const newSkillId = skillRows[0]!.id;

        await client.query(
          `UPDATE ops.skill_draft
             SET status = 'promoted',
                 promoted_skill_id = $2,
                 updated_at = now()
           WHERE id = $1`,
          [draft.id, newSkillId],
        );

        await audit(
          {
            scope,
            action: "skill_draft.promote",
            target_type: "skill",
            target_id: newSkillId,
            metadata: {
              skill_draft_id: draft.id,
              slug: draft.proposed_slug,
              version: nextVersion,
              source_document_id: draft.source_document_id,
            },
          },
          client,
        );

        return {
          kind: "ok" as const,
          skill_id: newSkillId,
          version: nextVersion,
        };
      });
      if (result.kind === "not_found") {
        return reply.code(404).send({ error: "not_found_or_not_draft" });
      }
      return reply.code(201).send({
        skill_id: result.skill_id,
        version: result.version,
      });
    },
  );

  // -- reject ------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/api/skill-drafts/:id/reject",
    async (req, reply) => {
      const scope = await resolveCallerScope(req);
      const result = await withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `UPDATE ops.skill_draft
             SET status = 'rejected', updated_at = now()
           WHERE id = $1 AND org_id = $2 AND status = 'draft'
           RETURNING id`,
          [req.params.id, scope.org_id],
        );
        if (rows.length === 0) return undefined;
        await audit(
          {
            scope,
            action: "skill_draft.reject",
            target_type: "skill_draft",
            target_id: rows[0]!.id,
            metadata: {},
          },
          client,
        );
        return rows[0];
      });
      if (!result) return reply.code(404).send({ error: "not_found_or_not_draft" });
      return reply.code(204).send();
    },
  );
}
