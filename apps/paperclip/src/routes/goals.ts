import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { generatePlan } from "../plan.js";
import { resolveCallerScope } from "../scope.js";
import { DecisionResolve, GoalCreate, GoalListQuery, GoalPatch, RunDispatch } from "../schemas.js";

type GoalRow = {
  id: string;
  org_id: string;
  department_id: string | null;
  owner_id: string | null;
  title: string;
  description: string | null;
  status: string;
  kind: string;
  cron_expr: string | null;
  due_at: string | null;
  progress: string | null;
  target_value: string | null;
  actual_value: string | null;
  delta_label: string | null;
  track_state: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const GOAL_COLUMNS = `
  id, org_id, department_id, owner_id, title, description, status,
  kind, cron_expr, due_at, progress, target_value, actual_value,
  delta_label, track_state, metadata, created_at, updated_at
`;

export async function goalRoutes(app: FastifyInstance): Promise<void> {
  // -- list ---------------------------------------------------------------
  app.get("/api/goals", async (req, reply) => {
    const parsed = GoalListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const where: string[] = ["org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (parsed.data.status) {
      params.push(parsed.data.status);
      where.push(`status = $${params.length}::ops.goal_status`);
    }
    if (parsed.data.kind) {
      params.push(parsed.data.kind);
      where.push(`kind = $${params.length}::ops.goal_kind`);
    }
    if (parsed.data.department_id) {
      params.push(parsed.data.department_id);
      where.push(`department_id = $${params.length}`);
    }
    params.push(parsed.data.limit);
    const sql = `
      SELECT ${GOAL_COLUMNS}
      FROM ops.goal
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `;
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<GoalRow>(sql, params);
      return rows;
    });
  });

  // -- create -------------------------------------------------------------
  app.post("/api/goals", async (req, reply) => {
    const parsed = GoalCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<GoalRow>(
        `
        INSERT INTO ops.goal (
          org_id, department_id, title, description, metadata,
          kind, cron_expr, due_at, target_value
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::ops.goal_kind, $7, $8, $9)
        RETURNING ${GOAL_COLUMNS}
        `,
        [
          scope.org_id,
          parsed.data.department_id ?? null,
          parsed.data.title,
          parsed.data.description ?? null,
          JSON.stringify(parsed.data.metadata ?? {}),
          parsed.data.kind ?? "ephemeral",
          parsed.data.cron_expr ?? null,
          parsed.data.due_at ?? null,
          parsed.data.target_value ?? null,
        ],
      );
      const goal = rows[0]!;
      await audit(
        {
          scope,
          action: "goal.create",
          target_type: "goal",
          target_id: goal.id,
          metadata: { title: goal.title, kind: goal.kind, department_id: goal.department_id },
        },
        client,
      );
      return goal;
    });
    return reply.code(201).send(result);
  });

  // -- get (with key_results + contributors embedded) --------------------
  app.get<{ Params: { id: string } }>("/api/goals/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const data = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<GoalRow>(
        `SELECT ${GOAL_COLUMNS} FROM ops.goal WHERE id = $1 AND org_id = $2`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return null;
      const goal = rows[0]!;
      const { rows: krs } = await client.query(
        `SELECT id, label, target_value, current_value, unit, weight, due_at, created_at, updated_at
         FROM ops.key_result WHERE goal_id = $1 ORDER BY created_at ASC`,
        [goal.id],
      );
      const { rows: contributors } = await client.query(
        `SELECT agent_id, user_id, added_at FROM ops.goal_contributor WHERE goal_id = $1`,
        [goal.id],
      );
      return { ...goal, key_results: krs, contributors };
    });
    if (!data) return reply.code(404).send({ error: "not_found" });
    return data;
  });

  // -- patch --------------------------------------------------------------
  app.patch<{ Params: { id: string } }>("/api/goals/:id", async (req, reply) => {
    const parsed = GoalPatch.safeParse(req.body);
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
    if (parsed.data.title !== undefined)        setCol("title", parsed.data.title);
    if (parsed.data.description !== undefined)  setCol("description", parsed.data.description);
    if (parsed.data.kind !== undefined)         setCol("kind", parsed.data.kind, "::ops.goal_kind");
    if (parsed.data.cron_expr !== undefined)    setCol("cron_expr", parsed.data.cron_expr);
    if (parsed.data.due_at !== undefined)       setCol("due_at", parsed.data.due_at);
    if (parsed.data.progress !== undefined)     setCol("progress", parsed.data.progress);
    if (parsed.data.target_value !== undefined) setCol("target_value", parsed.data.target_value);
    if (parsed.data.actual_value !== undefined) setCol("actual_value", parsed.data.actual_value);
    if (parsed.data.delta_label !== undefined)  setCol("delta_label", parsed.data.delta_label);
    if (parsed.data.track_state !== undefined)  setCol("track_state", parsed.data.track_state);
    if (parsed.data.metadata !== undefined)     setCol("metadata", JSON.stringify(parsed.data.metadata), "::jsonb");
    if (parsed.data.status !== undefined)       setCol("status", parsed.data.status, "::ops.goal_status");
    if (sets.length === 0) return reply.code(400).send({ error: "no_changes" });
    sets.push("updated_at = now()");
    const sql = `UPDATE ops.goal SET ${sets.join(", ")} WHERE id = $1 AND org_id = $2 RETURNING ${GOAL_COLUMNS}`;
    const result = await withOrgScope(scope.org_id, async (client) => {
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
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
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

  // -- resolve a decision -------------------------------------------------
  // Decision goals (kind=decision) accumulate in the inbox until the user
  // approves or declines. Resolving moves the goal to a terminal state and
  // logs the resolution + note for audit.
  app.post<{ Params: { id: string } }>("/api/goals/:id/resolve", async (req, reply) => {
    const parsed = DecisionResolve.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<GoalRow>(
        `SELECT ${GOAL_COLUMNS} FROM ops.goal
          WHERE id = $1 AND org_id = $2 FOR UPDATE`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return { kind: "not_found" as const };
      const goal = rows[0]!;
      if (goal.kind !== "decision") {
        return { kind: "wrong_kind" as const, goal };
      }
      if (goal.status === "achieved" || goal.status === "archived") {
        return { kind: "already_resolved" as const, goal };
      }

      const newStatus = parsed.data.resolution === "approved" ? "achieved" : "archived";
      const mergedMeta = {
        ...(goal.metadata ?? {}),
        resolution: parsed.data.resolution,
        resolution_note: parsed.data.note ?? null,
        resolved_at: new Date().toISOString(),
      };
      const { rows: updated } = await client.query<GoalRow>(
        `UPDATE ops.goal
            SET status   = $2::ops.goal_status,
                metadata = $3::jsonb,
                updated_at = now()
          WHERE id = $1
          RETURNING ${GOAL_COLUMNS}`,
        [goal.id, newStatus, JSON.stringify(mergedMeta)],
      );
      await audit(
        {
          scope,
          action: parsed.data.resolution === "approved" ? "decision.approve" : "decision.decline",
          target_type: "goal",
          target_id: goal.id,
          metadata: { note: parsed.data.note ?? null },
        },
        client,
      );
      return { kind: "ok" as const, goal: updated[0]! };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.kind === "wrong_kind") {
      return reply.code(409).send({ error: "not_a_decision", current_kind: result.goal.kind });
    }
    if (result.kind === "already_resolved") {
      return reply.code(409).send({ error: "already_resolved", current_status: result.goal.status });
    }
    return result.goal;
  });

  // -- plan ---------------------------------------------------------------
  app.post<{ Params: { id: string } }>("/api/goals/:id/plan", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<GoalRow>(
        "SELECT * FROM ops.goal WHERE id = $1 AND org_id = $2",
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return { kind: "not_found" as const };
      const goal = rows[0]!;
      const subtasks = generatePlan({ title: goal.title, description: goal.description });
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
      return { kind: "ok" as const, subtasks };
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });

    return reply.send({ subtasks: result.subtasks });
  });

  // -- dispatch -----------------------------------------------------------
  app.post<{ Params: { id: string } }>("/api/goals/:id/dispatch", async (req, reply) => {
    const parsed = RunDispatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<GoalRow>(
        "SELECT * FROM ops.goal WHERE id = $1 AND org_id = $2",
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return { kind: "not_found" as const };
      const goal = rows[0]!;
      const plan = (goal.metadata as { plan?: { subtasks: unknown[] } } | null)?.plan;
      if (!plan || !Array.isArray(plan.subtasks) || plan.subtasks.length === 0) {
        return { kind: "no_plan" as const };
      }
      const subtask = plan.subtasks[parsed.data.subtask_index];
      if (!subtask) return { kind: "out_of_range" as const };
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
      return { kind: "ok" as const, runId };
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.kind === "no_plan") {
      return reply.code(409).send({ error: "no_plan", hint: "POST /api/goals/{id}/plan first" });
    }
    if (result.kind === "out_of_range") return reply.code(400).send({ error: "subtask_index_out_of_range" });
    return reply.code(201).send({ run_id: result.runId, status: "queued" });
  });

  // -- dispatch all (run plan) -------------------------------------------
  app.post<{ Params: { id: string } }>("/api/goals/:id/dispatch-all", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<GoalRow>(
        "SELECT * FROM ops.goal WHERE id = $1 AND org_id = $2",
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return { kind: "not_found" as const };
      const goal = rows[0]!;
      const plan = (goal.metadata as { plan?: { subtasks: { index: number }[] } } | null)?.plan;
      if (!plan || !Array.isArray(plan.subtasks) || plan.subtasks.length === 0) {
        return { kind: "no_plan" as const };
      }
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
      return { kind: "ok" as const, ids };
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.kind === "no_plan") {
      return reply.code(409).send({ error: "no_plan", hint: "POST /api/goals/{id}/plan first" });
    }
    return reply.code(201).send({ run_ids: result.ids, queued: result.ids.length });
  });
}
