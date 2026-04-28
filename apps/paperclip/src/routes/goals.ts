import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { query, tx } from "../db.js";
import { generatePlan } from "../plan.js";
import { resolveCallerScope } from "../scope.js";
import { GoalCreate, GoalListQuery, GoalPatch, RunDispatch } from "../schemas.js";

type GoalRow = {
  id: string;
  org_id: string;
  department_id: string | null;
  owner_id: string | null;
  title: string;
  description: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function goalRoutes(app: FastifyInstance): Promise<void> {
  // -- list ---------------------------------------------------------------
  app.get("/api/goals", async (req, reply) => {
    const parsed = GoalListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope();
    const where: string[] = ["org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (parsed.data.status) {
      params.push(parsed.data.status);
      where.push(`status = $${params.length}::ops.goal_status`);
    }
    if (parsed.data.department_id) {
      params.push(parsed.data.department_id);
      where.push(`department_id = $${params.length}`);
    }
    params.push(parsed.data.limit);
    const sql = `
      SELECT id, org_id, department_id, owner_id, title, description, status, metadata, created_at, updated_at
      FROM ops.goal
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `;
    const { rows } = await query<GoalRow>(sql, params);
    return rows;
  });

  // -- create -------------------------------------------------------------
  app.post("/api/goals", async (req, reply) => {
    const parsed = GoalCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope();
    const result = await tx(async (client) => {
      const { rows } = await client.query<GoalRow>(
        `
        INSERT INTO ops.goal (org_id, department_id, title, description, metadata)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        RETURNING id, org_id, department_id, owner_id, title, description, status, metadata, created_at, updated_at
        `,
        [
          scope.org_id,
          parsed.data.department_id ?? null,
          parsed.data.title,
          parsed.data.description ?? null,
          JSON.stringify(parsed.data.metadata ?? {}),
        ],
      );
      const goal = rows[0]!;
      await audit(
        {
          scope,
          action: "goal.create",
          target_type: "goal",
          target_id: goal.id,
          metadata: { title: goal.title, department_id: goal.department_id },
        },
        client,
      );
      return goal;
    });
    return reply.code(201).send(result);
  });

  // -- get ----------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/goals/:id", async (req, reply) => {
    const scope = await resolveCallerScope();
    const { rows } = await query<GoalRow>(
      `SELECT id, org_id, department_id, owner_id, title, description, status, metadata, created_at, updated_at
       FROM ops.goal WHERE id = $1 AND org_id = $2`,
      [req.params.id, scope.org_id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });

  // -- patch --------------------------------------------------------------
  app.patch<{ Params: { id: string } }>("/api/goals/:id", async (req, reply) => {
    const parsed = GoalPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope();
    const sets: string[] = [];
    const params: unknown[] = [req.params.id, scope.org_id];
    if (parsed.data.title !== undefined) {
      params.push(parsed.data.title);
      sets.push(`title = $${params.length}`);
    }
    if (parsed.data.description !== undefined) {
      params.push(parsed.data.description);
      sets.push(`description = $${params.length}`);
    }
    if (parsed.data.metadata !== undefined) {
      params.push(JSON.stringify(parsed.data.metadata));
      sets.push(`metadata = $${params.length}::jsonb`);
    }
    if (parsed.data.status !== undefined) {
      params.push(parsed.data.status);
      sets.push(`status = $${params.length}::ops.goal_status`);
    }
    if (sets.length === 0) return reply.code(400).send({ error: "no_changes" });
    sets.push("updated_at = now()");
    const sql = `UPDATE ops.goal SET ${sets.join(", ")} WHERE id = $1 AND org_id = $2 RETURNING *`;
    const result = await tx(async (client) => {
      const { rows } = await client.query<GoalRow>(sql, params);
      if (rows.length === 0) return undefined;
      const goal = rows[0]!;
      await audit(
        {
          scope,
          action: "goal.update",
          target_type: "goal",
          target_id: goal.id,
          metadata: parsed.data,
        },
        client,
      );
      return goal;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return result;
  });

  // -- archive ------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/api/goals/:id", async (req, reply) => {
    const scope = await resolveCallerScope();
    const result = await tx(async (client) => {
      const { rows } = await client.query<GoalRow>(
        `UPDATE ops.goal SET status = 'archived', updated_at = now()
         WHERE id = $1 AND org_id = $2 RETURNING *`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      const goal = rows[0]!;
      await audit(
        { scope, action: "goal.archive", target_type: "goal", target_id: goal.id },
        client,
      );
      return goal;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return result;
  });

  // -- plan ---------------------------------------------------------------
  app.post<{ Params: { id: string } }>("/api/goals/:id/plan", async (req, reply) => {
    const scope = await resolveCallerScope();
    const { rows } = await query<GoalRow>(
      "SELECT * FROM ops.goal WHERE id = $1 AND org_id = $2",
      [req.params.id, scope.org_id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    const goal = rows[0]!;
    const subtasks = generatePlan({ title: goal.title, description: goal.description });

    const result = await tx(async (client) => {
      const merged = { ...(goal.metadata ?? {}), plan: { subtasks, generated_at: new Date().toISOString() } };
      await client.query(
        "UPDATE ops.goal SET metadata = $2::jsonb, updated_at = now() WHERE id = $1",
        [goal.id, JSON.stringify(merged)],
      );
      await audit(
        {
          scope,
          action: "goal.plan",
          target_type: "goal",
          target_id: goal.id,
          metadata: { subtask_count: subtasks.length },
        },
        client,
      );
      return subtasks;
    });

    return reply.send({ subtasks: result });
  });

  // -- dispatch -----------------------------------------------------------
  app.post<{ Params: { id: string } }>("/api/goals/:id/dispatch", async (req, reply) => {
    const parsed = RunDispatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope();
    const { rows } = await query<GoalRow>(
      "SELECT * FROM ops.goal WHERE id = $1 AND org_id = $2",
      [req.params.id, scope.org_id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    const goal = rows[0]!;
    const plan = (goal.metadata as { plan?: { subtasks: unknown[] } } | null)?.plan;
    if (!plan || !Array.isArray(plan.subtasks) || plan.subtasks.length === 0) {
      return reply
        .code(409)
        .send({ error: "no_plan", hint: "POST /api/goals/{id}/plan first" });
    }
    const subtask = plan.subtasks[parsed.data.subtask_index];
    if (!subtask) {
      return reply.code(400).send({ error: "subtask_index_out_of_range" });
    }
    const result = await tx(async (client) => {
      const { rows: runRows } = await client.query<{ id: string }>(
        `INSERT INTO ops.run (goal_id, agent_id, status, input)
         VALUES ($1, $2, 'queued', $3::jsonb)
         RETURNING id`,
        [goal.id, parsed.data.agent_id ?? null, JSON.stringify({ subtask })],
      );
      const runId = runRows[0]!.id;
      // Bump goal to active on first dispatch.
      await client.query(
        "UPDATE ops.goal SET status = CASE WHEN status = 'draft' THEN 'active'::ops.goal_status ELSE status END, updated_at = now() WHERE id = $1",
        [goal.id],
      );
      await audit(
        {
          scope,
          action: "run.dispatch",
          target_type: "run",
          target_id: runId,
          metadata: { goal_id: goal.id, subtask_index: parsed.data.subtask_index },
        },
        client,
      );
      return runId;
    });
    return reply.code(201).send({ run_id: result, status: "queued" });
  });

  // -- dispatch all (run plan) -------------------------------------------
  app.post<{ Params: { id: string } }>("/api/goals/:id/dispatch-all", async (req, reply) => {
    const scope = await resolveCallerScope();
    const { rows } = await query<GoalRow>(
      "SELECT * FROM ops.goal WHERE id = $1 AND org_id = $2",
      [req.params.id, scope.org_id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    const goal = rows[0]!;
    const plan = (goal.metadata as { plan?: { subtasks: { index: number }[] } } | null)?.plan;
    if (!plan || !Array.isArray(plan.subtasks) || plan.subtasks.length === 0) {
      return reply.code(409).send({ error: "no_plan", hint: "POST /api/goals/{id}/plan first" });
    }
    const queued = await tx(async (client) => {
      const ids: string[] = [];
      for (const st of plan.subtasks) {
        const { rows: runRows } = await client.query<{ id: string }>(
          `INSERT INTO ops.run (goal_id, status, input)
           VALUES ($1, 'queued', $2::jsonb) RETURNING id`,
          [goal.id, JSON.stringify({ subtask: st })],
        );
        const runId = runRows[0]!.id;
        ids.push(runId);
        await audit(
          {
            scope,
            action: "run.dispatch",
            target_type: "run",
            target_id: runId,
            metadata: { goal_id: goal.id, subtask_index: st.index, source: "dispatch-all" },
          },
          client,
        );
      }
      await client.query(
        "UPDATE ops.goal SET status = CASE WHEN status = 'draft' THEN 'active'::ops.goal_status ELSE status END, updated_at = now() WHERE id = $1",
        [goal.id],
      );
      return ids;
    });
    return reply.code(201).send({ run_ids: queued, queued: queued.length });
  });
}
