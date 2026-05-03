/**
 * Swarm routes — Chief-of-Staff planner + DAG dispatch + subtask listing.
 *
 *   POST /api/goals/:id/plan-swarm        Chief decomposes the goal,
 *                                         persists the resulting subtasks.
 *                                         Idempotent: replan replaces the
 *                                         existing pending/ready/cancelled
 *                                         set; succeeded subtasks are kept
 *                                         (their work is done).
 *   GET  /api/goals/:id/subtasks          List subtasks with status + deps.
 *   POST /api/goals/:id/dispatch-swarm    Find ready subtasks + queue runs.
 *                                         Body { replan?: boolean }.
 *   POST /api/subtasks/:id/cancel         Move a non-terminal subtask to
 *                                         cancelled; cascade dependents.
 *
 * Goals without any subtask rows continue to use the legacy flat-plan
 * path (`/api/goals/:id/plan` + `/dispatch` + `/dispatch-all`). Both
 * shapes coexist; `plan-swarm` is opt-in.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import { SwarmDispatchBody } from "../schemas.js";
import { chiefDecompose } from "../swarms/chief.js";
import { dispatchReadySubtasks } from "../swarms/dispatch.js";

type SubtaskRow = {
  id: string;
  org_id: string;
  goal_id: string;
  ordinal: number;
  title: string;
  instruction: string;
  agent_kind: string;
  skill_slug: string | null;
  depends_on: string[];
  status: string;
  run_id: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS = `
  id, org_id, goal_id, ordinal, title, instruction, agent_kind, skill_slug,
  depends_on, status, run_id, output, error, created_at, updated_at
`;

export async function swarmRoutes(app: FastifyInstance): Promise<void> {
  // -- plan via Chief of Staff -------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/api/goals/:id/plan-swarm",
    async (req, reply) => {
      const scope = await resolveCallerScope(req);
      const result = await withOrgScope(scope.org_id, async (client) => {
        const { rows: goals } = await client.query<{
          id: string;
          title: string;
          description: string | null;
        }>(
          `SELECT id, title, description FROM ops.goal
            WHERE id = $1 AND org_id = $2`,
          [req.params.id, scope.org_id],
        );
        if (goals.length === 0) return { kind: "not_found" as const };
        const goal = goals[0]!;

        // Pull the org's available skills so the Chief can ground its
        // skill_slug picks. Same lookup the SOP→Skill extractor uses.
        const { rows: skills } = await client.query<{
          slug: string;
          agent_kind: string;
          description: string | null;
        }>(
          `SELECT slug, agent_kind, description
             FROM ops.skill
            WHERE (org_id IS NULL OR org_id = $1) AND enabled = true
            ORDER BY slug ASC LIMIT 60`,
          [scope.org_id],
        );

        const plan = await chiefDecompose({
          title: goal.title,
          description: goal.description,
          registry: skills,
        });

        // Replace pending/ready/cancelled subtasks; keep succeeded ones
        // (their work is already done — re-running it would be waste).
        await client.query(
          `DELETE FROM ops.subtask
            WHERE goal_id = $1
              AND status IN ('pending','ready','cancelled')`,
          [goal.id],
        );

        // Insert in two passes so depends_on can reference fresh ids.
        const ordinalToId = new Map<number, string>();
        for (const step of plan.steps) {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO ops.subtask
               (org_id, goal_id, ordinal, title, instruction, agent_kind,
                skill_slug, depends_on, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, ARRAY[]::uuid[], 'pending')
             RETURNING id`,
            [
              scope.org_id,
              goal.id,
              step.ordinal,
              step.title,
              step.instruction,
              step.agent_kind,
              step.skill_slug,
            ],
          );
          ordinalToId.set(step.ordinal, rows[0]!.id);
        }
        for (const step of plan.steps) {
          if (step.depends_on_ordinals.length === 0) continue;
          const depIds = step.depends_on_ordinals
            .map((o) => ordinalToId.get(o))
            .filter((x): x is string => !!x);
          await client.query(
            `UPDATE ops.subtask SET depends_on = $2::uuid[]
              WHERE id = $1`,
            [ordinalToId.get(step.ordinal), depIds],
          );
        }

        await audit(
          {
            scope,
            action: "goal.plan_swarm",
            target_type: "goal",
            target_id: goal.id,
            metadata: {
              steps: plan.steps.length,
              warnings: plan.warnings.length,
              llm_provider: plan.llm_provider,
              llm_model: plan.llm_model,
            },
          },
          client,
        );

        const { rows: persisted } = await client.query<SubtaskRow>(
          `SELECT ${COLUMNS} FROM ops.subtask
            WHERE goal_id = $1 ORDER BY ordinal ASC`,
          [goal.id],
        );

        return {
          kind: "ok" as const,
          subtasks: persisted,
          warnings: plan.warnings,
          llm_provider: plan.llm_provider,
          llm_model: plan.llm_model,
        };
      });
      if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
      return reply.code(201).send({
        subtasks: result.subtasks,
        warnings: result.warnings,
        llm_provider: result.llm_provider,
        llm_model: result.llm_model,
      });
    },
  );

  // -- list subtasks -----------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/api/goals/:id/subtasks",
    async (req) => {
      const scope = await resolveCallerScope(req);
      return withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<SubtaskRow>(
          `SELECT ${COLUMNS} FROM ops.subtask
            WHERE goal_id = $1 AND org_id = $2
            ORDER BY ordinal ASC`,
          [req.params.id, scope.org_id],
        );
        return rows;
      });
    },
  );

  // -- dispatch swarm (queue all currently-ready subtasks) --------------
  app.post<{ Params: { id: string } }>(
    "/api/goals/:id/dispatch-swarm",
    async (req, reply) => {
      const parsed = SwarmDispatchBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const scope = await resolveCallerScope(req);

      // Optional re-plan: re-run the Chief first.
      if (parsed.data.replan) {
        // Reuse the plan-swarm logic by calling fastify's inject? Simpler:
        // duplicate the small block here. Keeps the test path small.
        await withOrgScope(scope.org_id, async (client) => {
          const { rows: goals } = await client.query<{
            id: string;
            title: string;
            description: string | null;
          }>(
            `SELECT id, title, description FROM ops.goal
              WHERE id = $1 AND org_id = $2`,
            [req.params.id, scope.org_id],
          );
          if (goals.length === 0) return;
          const goal = goals[0]!;
          const { rows: skills } = await client.query<{
            slug: string;
            agent_kind: string;
            description: string | null;
          }>(
            `SELECT slug, agent_kind, description FROM ops.skill
              WHERE (org_id IS NULL OR org_id = $1) AND enabled = true
              ORDER BY slug ASC LIMIT 60`,
            [scope.org_id],
          );
          const plan = await chiefDecompose({
            title: goal.title,
            description: goal.description,
            registry: skills,
          });
          await client.query(
            `DELETE FROM ops.subtask
              WHERE goal_id = $1 AND status IN ('pending','ready','cancelled')`,
            [goal.id],
          );
          const ordinalToId = new Map<number, string>();
          for (const step of plan.steps) {
            const { rows } = await client.query<{ id: string }>(
              `INSERT INTO ops.subtask
                 (org_id, goal_id, ordinal, title, instruction, agent_kind,
                  skill_slug, depends_on, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, ARRAY[]::uuid[], 'pending')
               RETURNING id`,
              [
                scope.org_id, goal.id, step.ordinal, step.title,
                step.instruction, step.agent_kind, step.skill_slug,
              ],
            );
            ordinalToId.set(step.ordinal, rows[0]!.id);
          }
          for (const step of plan.steps) {
            if (step.depends_on_ordinals.length === 0) continue;
            const depIds = step.depends_on_ordinals
              .map((o) => ordinalToId.get(o))
              .filter((x): x is string => !!x);
            await client.query(
              `UPDATE ops.subtask SET depends_on = $2::uuid[] WHERE id = $1`,
              [ordinalToId.get(step.ordinal), depIds],
            );
          }
        });
      }

      const result = await withOrgScope(scope.org_id, async (client) => {
        const { rows: goals } = await client.query<{ id: string }>(
          `SELECT id FROM ops.goal WHERE id = $1 AND org_id = $2`,
          [req.params.id, scope.org_id],
        );
        if (goals.length === 0) return { kind: "not_found" as const };
        const dispatched = await dispatchReadySubtasks(
          client,
          req.params.id,
          scope,
        );
        await audit(
          {
            scope,
            action: "goal.dispatch_swarm",
            target_type: "goal",
            target_id: req.params.id,
            metadata: {
              queued_count: dispatched.queued_subtask_ids.length,
            },
          },
          client,
        );
        return { kind: "ok" as const, ...dispatched };
      });
      if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
      return reply.code(202).send({
        queued_subtask_ids: result.queued_subtask_ids,
        queued_run_ids: result.queued_run_ids,
      });
    },
  );

  // -- cancel a subtask --------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/api/subtasks/:id/cancel",
    async (req, reply) => {
      const scope = await resolveCallerScope(req);
      const result = await withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<{
          id: string;
          goal_id: string;
          run_id: string | null;
          status: string;
        }>(
          `UPDATE ops.subtask
              SET status = 'cancelled',
                  error = COALESCE(error, 'cancelled by operator'),
                  updated_at = now()
            WHERE id = $1 AND org_id = $2
              AND status IN ('pending','ready','queued','running')
            RETURNING id, goal_id, run_id, status`,
          [req.params.id, scope.org_id],
        );
        if (rows.length === 0) return undefined;
        const row = rows[0]!;
        // If a run was already queued/running, cancel it too.
        if (row.run_id) {
          await client.query(
            `UPDATE ops.run SET status = 'cancelled', finished_at = now()
              WHERE id = $1 AND status IN ('queued','running')`,
            [row.run_id],
          );
        }
        await audit(
          {
            scope,
            action: "subtask.cancel",
            target_type: "subtask",
            target_id: row.id,
            metadata: { goal_id: row.goal_id, run_id: row.run_id },
          },
          client,
        );
        return row;
      });
      if (!result) return reply.code(404).send({ error: "not_found_or_terminal" });
      return reply.code(204).send();
    },
  );
}
