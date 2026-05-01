/**
 * Skills API.
 *
 *   GET    /api/skills                  list available skills for the caller
 *   GET    /api/skills/:slug            single manifest
 *   POST   /api/skills/:slug/invoke     synthesise an ephemeral goal +
 *                                       dispatch one run on the right agent
 *
 * The caller's RLS scope determines which skills come back: shared skills
 * (org_id NULL) plus any company- or personal-scoped skills owned by the
 * caller's org. The invoke endpoint creates a one-shot ephemeral goal whose
 * plan is "execute this skill with these inputs," then queues it through the
 * existing run pipeline. The frontend never has to construct the run payload
 * itself.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { query, tx } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import { SkillListQuery } from "../schemas.js";

type SkillRow = {
  id: string;
  org_id: string | null;
  slug: string;
  version: number;
  scope: string;
  mode_aware: boolean;
  agent_kind: string;
  title: string;
  description: string | null;
  manifest_path: string;
  params_schema: Record<string, unknown>;
  side_effects: string;
  required_role: string | null;
  approval_under: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

const SKILL_COLUMNS = `
  id, org_id, slug, version, scope, mode_aware, agent_kind, title,
  description, manifest_path, params_schema, side_effects, required_role,
  approval_under, enabled, created_at, updated_at
`;

export async function skillRoutes(app: FastifyInstance): Promise<void> {
  // -- list ---------------------------------------------------------------
  app.get("/api/skills", async (req, reply) => {
    const parsed = SkillListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const where: string[] = ["(org_id IS NULL OR org_id = $1)", "enabled = true"];
    const params: unknown[] = [scope.org_id];
    if (parsed.data.scope) {
      params.push(parsed.data.scope);
      where.push(`scope = $${params.length}::ops.skill_scope`);
    }
    if (parsed.data.agent_kind) {
      params.push(parsed.data.agent_kind);
      where.push(`agent_kind = $${params.length}`);
    }
    if (parsed.data.enabled !== undefined) {
      params.push(parsed.data.enabled);
      where.push(`enabled = $${params.length}`);
    }
    const { rows } = await query<SkillRow>(
      `SELECT ${SKILL_COLUMNS} FROM ops.skill
        WHERE ${where.join(" AND ")}
        ORDER BY scope DESC, slug ASC, version DESC`,
      params,
    );
    return rows;
  });

  // -- get one ------------------------------------------------------------
  app.get<{ Params: { slug: string } }>("/api/skills/:slug", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const { rows } = await query<SkillRow>(
      `SELECT ${SKILL_COLUMNS} FROM ops.skill
        WHERE slug = $1
          AND (org_id IS NULL OR org_id = $2)
          AND enabled = true
        ORDER BY version DESC LIMIT 1`,
      [req.params.slug, scope.org_id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });

  // -- invoke -------------------------------------------------------------
  app.post<{ Params: { slug: string }; Body: { inputs?: Record<string, unknown>; title?: string } }>(
    "/api/skills/:slug/invoke",
    async (req, reply) => {
      const scope = await resolveCallerScope(req);
      const inputs = req.body?.inputs ?? {};
      const titleHint = req.body?.title?.slice(0, 200) ?? `Run ${req.params.slug}`;

      const { rows: skillRows } = await query<SkillRow>(
        `SELECT ${SKILL_COLUMNS} FROM ops.skill
          WHERE slug = $1
            AND (org_id IS NULL OR org_id = $2)
            AND enabled = true
          ORDER BY version DESC LIMIT 1`,
        [req.params.slug, scope.org_id],
      );
      if (skillRows.length === 0) return reply.code(404).send({ error: "skill_not_found" });
      const skill = skillRows[0]!;

      const result = await tx(async (client) => {
        // Ephemeral goal carries the skill invocation. The run queue picks
        // it up and dispatches to the agent kind declared in the manifest.
        const { rows: goalRows } = await client.query<{ id: string }>(
          `INSERT INTO ops.goal (
             org_id, title, kind, metadata
           )
           VALUES ($1, $2, 'ephemeral'::ops.goal_kind, $3::jsonb)
           RETURNING id`,
          [
            scope.org_id,
            titleHint,
            JSON.stringify({
              source: "skill.invoke",
              skill: skill.slug,
              skill_version: skill.version,
            }),
          ],
        );
        const goalId = goalRows[0]!.id;

        const { rows: runRows } = await client.query<{ id: string }>(
          `INSERT INTO ops.run (goal_id, status, input)
           VALUES ($1, 'queued', $2::jsonb)
           RETURNING id`,
          [
            goalId,
            JSON.stringify({
              skill: skill.slug,
              agent_kind: skill.agent_kind,
              inputs,
            }),
          ],
        );
        const runId = runRows[0]!.id;

        await audit(
          {
            scope,
            action: "skill.invoke",
            target_type: "run",
            target_id: runId,
            metadata: {
              skill: skill.slug,
              version: skill.version,
              goal_id: goalId,
              agent_kind: skill.agent_kind,
            },
          },
          client,
        );

        return { goal_id: goalId, run_id: runId };
      });

      return reply.code(201).send({
        goal_id: result.goal_id,
        run_id: result.run_id,
        status: "queued",
        skill: { slug: skill.slug, version: skill.version, agent_kind: skill.agent_kind },
      });
    },
  );
}
