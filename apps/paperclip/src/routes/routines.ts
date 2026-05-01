/**
 * Routines API.
 *
 *   GET    /api/goals/:goal_id/triggers         list triggers for a routine
 *   POST   /api/goals/:goal_id/triggers         add a trigger (schedule/event/api)
 *   PATCH  /api/routines/triggers/:id           edit trigger spec / enabled
 *   DELETE /api/routines/triggers/:id           remove a trigger
 *   POST   /api/routines/triggers/:id/fire      manual fire for testing OR
 *                                               webhook target for trigger_kind=api
 *
 * Schedule triggers also live as `ops.goal.cron_expr` so the scheduler in
 * scheduler.ts can stay simple. Adding a schedule trigger via this API
 * mirrors the cron_expr onto the goal.
 */

import { randomBytes } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { query, tx } from "../db.js";
import { fireRoutineFromTrigger } from "../routines/triggers.js";
import { resolveCallerScope } from "../scope.js";
import { RoutineTriggerCreate, RoutineTriggerPatch } from "../schemas.js";

type TriggerRowFull = {
  id: string;
  goal_id: string;
  trigger_kind: "schedule" | "event" | "api";
  trigger_spec: Record<string, unknown>;
  enabled: boolean;
  last_fired_at: string | null;
  created_at: string;
};

const TRIGGER_COLUMNS = "id, goal_id, trigger_kind, trigger_spec, enabled, last_fired_at, created_at";

async function ownedRoutineGoal(goalId: string, orgId: string): Promise<{ kind: string } | null> {
  const { rows } = await query<{ kind: string }>(
    "SELECT kind FROM ops.goal WHERE id = $1 AND org_id = $2",
    [goalId, orgId],
  );
  return rows[0] ?? null;
}

export async function routineRoutes(app: FastifyInstance): Promise<void> {
  // -- list triggers for a goal -------------------------------------------
  app.get<{ Params: { goal_id: string } }>(
    "/api/goals/:goal_id/triggers",
    async (req, reply) => {
      const scope = await resolveCallerScope(req);
      const goal = await ownedRoutineGoal(req.params.goal_id, scope.org_id);
      if (!goal) return reply.code(404).send({ error: "not_found" });
      const { rows } = await query<TriggerRowFull>(
        `SELECT ${TRIGGER_COLUMNS} FROM ops.routine_trigger
          WHERE goal_id = $1 ORDER BY created_at ASC`,
        [req.params.goal_id],
      );
      return rows;
    },
  );

  // -- add a trigger ------------------------------------------------------
  app.post<{ Params: { goal_id: string } }>(
    "/api/goals/:goal_id/triggers",
    async (req, reply) => {
      const parsed = RoutineTriggerCreate.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const scope = await resolveCallerScope(req);
      const goal = await ownedRoutineGoal(req.params.goal_id, scope.org_id);
      if (!goal) return reply.code(404).send({ error: "not_found" });

      // Triggers only make sense on routine goals. Be friendly if the user
      // forgot — bump the kind for them when it's still 'ephemeral'.
      // Decision goals shouldn't fire automatically; reject those.
      if (goal.kind !== "routine" && goal.kind !== "ephemeral") {
        return reply
          .code(409)
          .send({ error: "not_a_routine", current_kind: goal.kind });
      }

      const spec = { ...(parsed.data.trigger_spec ?? {}) };
      // For api triggers, auto-mint an endpoint_token if missing.
      if (parsed.data.trigger_kind === "api" && typeof spec.endpoint_token !== "string") {
        spec.endpoint_token = randomBytes(18).toString("hex");
      }

      const result = await tx(async (client) => {
        const { rows } = await client.query<TriggerRowFull>(
          `INSERT INTO ops.routine_trigger (goal_id, trigger_kind, trigger_spec, enabled)
           VALUES ($1, $2::ops.routine_trigger_kind, $3::jsonb, $4)
           RETURNING ${TRIGGER_COLUMNS}`,
          [
            req.params.goal_id,
            parsed.data.trigger_kind,
            JSON.stringify(spec),
            parsed.data.enabled,
          ],
        );
        const trigger = rows[0]!;

        // For schedule triggers, also stamp goal.cron_expr + bump to routine kind
        // so the existing scheduler picks it up without changes.
        if (parsed.data.trigger_kind === "schedule" && typeof spec.cron_expr === "string") {
          await client.query(
            `UPDATE ops.goal
                SET kind = 'routine'::ops.goal_kind,
                    cron_expr = $2,
                    updated_at = now()
              WHERE id = $1`,
            [req.params.goal_id, spec.cron_expr],
          );
        }

        await audit(
          {
            scope,
            action: "routine.trigger.create",
            target_type: "routine_trigger",
            target_id: trigger.id,
            metadata: {
              goal_id: req.params.goal_id,
              trigger_kind: parsed.data.trigger_kind,
            },
          },
          client,
        );
        return trigger;
      });
      return reply.code(201).send(result);
    },
  );

  // -- patch trigger ------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    "/api/routines/triggers/:id",
    async (req, reply) => {
      const parsed = RoutineTriggerPatch.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const scope = await resolveCallerScope(req);
      const sets: string[] = [];
      const params: unknown[] = [req.params.id, scope.org_id];
      if (parsed.data.trigger_spec !== undefined) {
        params.push(JSON.stringify(parsed.data.trigger_spec));
        sets.push(`trigger_spec = $${params.length}::jsonb`);
      }
      if (parsed.data.enabled !== undefined) {
        params.push(parsed.data.enabled);
        sets.push(`enabled = $${params.length}`);
      }
      if (sets.length === 0) return reply.code(400).send({ error: "no_changes" });

      const result = await tx(async (client) => {
        const { rows } = await client.query<TriggerRowFull>(
          `UPDATE ops.routine_trigger t
              SET ${sets.join(", ")}
            FROM ops.goal g
           WHERE t.id = $1
             AND t.goal_id = g.id
             AND g.org_id = $2
           RETURNING ${TRIGGER_COLUMNS.split(",").map((c) => "t." + c.trim()).join(", ")}`,
          params,
        );
        if (rows.length === 0) return undefined;
        const trigger = rows[0]!;
        await audit(
          {
            scope,
            action: "routine.trigger.update",
            target_type: "routine_trigger",
            target_id: trigger.id,
            metadata: parsed.data,
          },
          client,
        );
        return trigger;
      });
      if (!result) return reply.code(404).send({ error: "not_found" });
      return result;
    },
  );

  // -- delete trigger -----------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    "/api/routines/triggers/:id",
    async (req, reply) => {
      const scope = await resolveCallerScope(req);
      const result = await tx(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `DELETE FROM ops.routine_trigger
            USING ops.goal g
            WHERE ops.routine_trigger.id = $1
              AND ops.routine_trigger.goal_id = g.id
              AND g.org_id = $2
            RETURNING ops.routine_trigger.id`,
          [req.params.id, scope.org_id],
        );
        if (rows.length === 0) return undefined;
        await audit(
          {
            scope,
            action: "routine.trigger.delete",
            target_type: "routine_trigger",
            target_id: rows[0]!.id,
          },
          client,
        );
        return rows[0]!.id;
      });
      if (!result) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send();
    },
  );

  // -- manual fire / api-trigger webhook ----------------------------------
  // For api triggers, the caller passes the token in the URL path. Anyone
  // with the token can fire (matches GitHub-style webhook auth). For
  // schedule/event triggers, the same endpoint exists for manual testing
  // — but requires the org scope to match (guarded by RLS via withOrgScope
  // when it lands on the route migration; for v0 we check explicitly).
  app.post<{ Params: { id: string }; Body?: { token?: string; metadata?: Record<string, unknown> } }>(
    "/api/routines/triggers/:id/fire",
    async (req, reply) => {
      const scope = await resolveCallerScope(req);
      const body = req.body ?? {};
      const result = await tx(async (client) => {
        const { rows } = await client.query<TriggerRowFull & { goal_org_id: string }>(
          `SELECT t.id, t.goal_id, t.trigger_kind, t.trigger_spec,
                  t.enabled, t.last_fired_at, t.created_at, g.org_id AS goal_org_id
             FROM ops.routine_trigger t
             JOIN ops.goal g ON g.id = t.goal_id
            WHERE t.id = $1`,
          [req.params.id],
        );
        if (rows.length === 0) return { kind: "not_found" as const };
        const trigger = rows[0]!;

        if (trigger.trigger_kind === "api") {
          const expected = (trigger.trigger_spec ?? {}).endpoint_token;
          if (typeof expected !== "string" || expected !== body.token) {
            return { kind: "bad_token" as const };
          }
        } else {
          // For schedule/event triggers, fall back to the caller's scope.
          if (trigger.goal_org_id !== scope.org_id) return { kind: "not_found" as const };
        }
        if (!trigger.enabled) return { kind: "disabled" as const };

        const fire = await fireRoutineFromTrigger(client, trigger, {
          cause: "manual_or_api",
          ...(body.metadata ?? {}),
        });
        await audit(
          {
            scope: { org_id: trigger.goal_org_id, role: "owner" },
            action: "routine.trigger.fire",
            target_type: "routine_trigger",
            target_id: trigger.id,
            metadata: { goal_id: trigger.goal_id, runs: fire.run_count },
          },
          client,
        );
        return { kind: "ok" as const, ...fire };
      });

      if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
      if (result.kind === "bad_token") return reply.code(403).send({ error: "bad_token" });
      if (result.kind === "disabled") return reply.code(409).send({ error: "trigger_disabled" });
      return { fired: true, run_count: result.run_count };
    },
  );
}
