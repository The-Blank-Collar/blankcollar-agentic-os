/**
 * Policy management — CRUD over `ops.policy`.
 *
 *   GET    /api/policies                       list rows for the org
 *   POST   /api/policies                       create one
 *   DELETE /api/policies/:id                   remove one
 *   POST   /api/policies/evaluate              dry-run the evaluator
 *
 * Wiring rules:
 *   - Effect & priority are required on create; criteria are nullable
 *     wildcards.
 *   - Update is intentionally not supported in v0 — policies are tiny
 *     and the create-then-delete cycle is the cleanest audit trail.
 *   - Evaluate dispatches to `evaluatePolicy()` so callers can preview
 *     what the engine *would* return for a candidate request.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { evaluatePolicy } from "../policy/evaluate.js";
import { resolveCallerScope } from "../scope.js";
import { PolicyCreate } from "../schemas.js";

type PolicyRow = {
  id: string;
  org_id: string;
  role: string | null;
  agent_kind: string | null;
  skill_slug: string | null;
  action_kind: string | null;
  effect: "allow" | "approve" | "deny";
  priority: number;
  reason: string | null;
  created_at: string;
};

const POLICY_COLUMNS =
  "id, org_id, role, agent_kind, skill_slug, action_kind, effect, priority, reason, created_at";

export async function policyRoutes(app: FastifyInstance): Promise<void> {
  // -- list ---------------------------------------------------------------
  app.get("/api/policies", async (req) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<PolicyRow>(
        `SELECT ${POLICY_COLUMNS} FROM ops.policy
          WHERE org_id = $1
          ORDER BY priority ASC, created_at DESC`,
        [scope.org_id],
      );
      return rows;
    });
  });

  // -- create -------------------------------------------------------------
  app.post("/api/policies", async (req, reply) => {
    const parsed = PolicyCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<PolicyRow>(
        `INSERT INTO ops.policy
            (org_id, role, agent_kind, skill_slug, action_kind, effect, priority, reason)
         VALUES ($1, $2::core.role_kind, $3, $4, $5, $6::ops.policy_effect, $7, $8)
         RETURNING ${POLICY_COLUMNS}`,
        [
          scope.org_id,
          parsed.data.role ?? null,
          parsed.data.agent_kind ?? null,
          parsed.data.skill_slug ?? null,
          parsed.data.action_kind ?? null,
          parsed.data.effect,
          parsed.data.priority,
          parsed.data.reason ?? null,
        ],
      );
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "policy.create",
          target_type: "policy",
          target_id: row.id,
          metadata: { effect: row.effect, priority: row.priority },
        },
        client,
      );
      return row;
    });
    return reply.code(201).send(result);
  });

  // -- delete -------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/api/policies/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `DELETE FROM ops.policy
          WHERE id = $1 AND org_id = $2
          RETURNING id`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      await audit(
        {
          scope,
          action: "policy.delete",
          target_type: "policy",
          target_id: rows[0]!.id,
          metadata: {},
        },
        client,
      );
      return rows[0];
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // -- evaluate (dry-run) -------------------------------------------------
  app.post<{
    Body: {
      role?: string;
      agent_kind?: string | null;
      skill_slug?: string | null;
      action_kind?: string | null;
    };
  }>("/api/policies/evaluate", async (req) => {
    const scope = await resolveCallerScope(req);
    const role = req.body?.role ?? scope.role;
    return withOrgScope(scope.org_id, async (client) => {
      return evaluatePolicy(client, {
        orgId: scope.org_id,
        role,
        agentKind: req.body?.agent_kind ?? null,
        skillSlug: req.body?.skill_slug ?? null,
        actionKind: req.body?.action_kind ?? null,
      });
    });
  });
}
