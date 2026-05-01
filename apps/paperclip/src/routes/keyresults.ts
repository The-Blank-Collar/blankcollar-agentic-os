/** Key results — child rows of a standing goal. */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { query, tx } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import { KeyResultCreate, KeyResultPatch } from "../schemas.js";

type KrRow = {
  id: string;
  goal_id: string;
  label: string;
  target_value: string | null;
  current_value: string | null;
  unit: string | null;
  weight: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

const KR_COLUMNS = "id, goal_id, label, target_value, current_value, unit, weight, due_at, created_at, updated_at";

async function ownedGoal(goalId: string, orgId: string): Promise<boolean> {
  const { rows } = await query("SELECT 1 FROM ops.goal WHERE id = $1 AND org_id = $2", [goalId, orgId]);
  return rows.length > 0;
}

export async function keyResultRoutes(app: FastifyInstance): Promise<void> {
  // -- list per goal ------------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/goals/:id/key-results", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    if (!(await ownedGoal(req.params.id, scope.org_id))) {
      return reply.code(404).send({ error: "not_found" });
    }
    const { rows } = await query<KrRow>(
      `SELECT ${KR_COLUMNS} FROM ops.key_result WHERE goal_id = $1 ORDER BY created_at ASC`,
      [req.params.id],
    );
    return rows;
  });

  // -- create -------------------------------------------------------------
  app.post<{ Params: { id: string } }>("/api/goals/:id/key-results", async (req, reply) => {
    const parsed = KeyResultCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    if (!(await ownedGoal(req.params.id, scope.org_id))) {
      return reply.code(404).send({ error: "not_found" });
    }

    const result = await tx(async (client) => {
      const { rows } = await client.query<KrRow>(
        `INSERT INTO ops.key_result (goal_id, label, target_value, current_value, unit, weight, due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${KR_COLUMNS}`,
        [
          req.params.id,
          parsed.data.label,
          parsed.data.target_value ?? null,
          parsed.data.current_value ?? null,
          parsed.data.unit ?? null,
          parsed.data.weight ?? 1.0,
          parsed.data.due_at ?? null,
        ],
      );
      const kr = rows[0]!;
      await audit(
        {
          scope,
          action: "key_result.create",
          target_type: "key_result",
          target_id: kr.id,
          metadata: { goal_id: req.params.id, label: kr.label },
        },
        client,
      );
      return kr;
    });
    return reply.code(201).send(result);
  });

  // -- patch --------------------------------------------------------------
  app.patch<{ Params: { id: string } }>("/api/key-results/:id", async (req, reply) => {
    const parsed = KeyResultPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const sets: string[] = [];
    const params: unknown[] = [req.params.id, scope.org_id];
    const setCol = (col: string, val: unknown): void => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (parsed.data.label !== undefined)         setCol("label", parsed.data.label);
    if (parsed.data.target_value !== undefined)  setCol("target_value", parsed.data.target_value);
    if (parsed.data.current_value !== undefined) setCol("current_value", parsed.data.current_value);
    if (parsed.data.unit !== undefined)          setCol("unit", parsed.data.unit);
    if (parsed.data.weight !== undefined)        setCol("weight", parsed.data.weight);
    if (parsed.data.due_at !== undefined)        setCol("due_at", parsed.data.due_at);
    if (sets.length === 0) return reply.code(400).send({ error: "no_changes" });
    sets.push("updated_at = now()");

    const sql = `
      UPDATE ops.key_result
         SET ${sets.join(", ")}
       WHERE id = $1
         AND goal_id IN (SELECT id FROM ops.goal WHERE org_id = $2)
       RETURNING ${KR_COLUMNS}
    `;
    const result = await tx(async (client) => {
      const { rows } = await client.query<KrRow>(sql, params);
      if (rows.length === 0) return undefined;
      const kr = rows[0]!;
      await audit(
        {
          scope,
          action: "key_result.update",
          target_type: "key_result",
          target_id: kr.id,
          metadata: { goal_id: kr.goal_id },
        },
        client,
      );
      return kr;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return result;
  });

  // -- delete -------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/api/key-results/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await tx(async (client) => {
      const { rows } = await client.query<{ id: string; goal_id: string }>(
        `DELETE FROM ops.key_result
          WHERE id = $1
            AND goal_id IN (SELECT id FROM ops.goal WHERE org_id = $2)
          RETURNING id, goal_id`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      const kr = rows[0]!;
      await audit(
        {
          scope,
          action: "key_result.delete",
          target_type: "key_result",
          target_id: kr.id,
          metadata: { goal_id: kr.goal_id },
        },
        client,
      );
      return kr;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
