/**
 * Autonomy mode CRUD + resolve preview.
 *
 *   GET    /api/autonomy             list every mode set across all scopes
 *   PUT    /api/autonomy             upsert one mode at one scope
 *   DELETE /api/autonomy/:id         remove a mode (revert to inherited)
 *   GET    /api/autonomy/resolve     preview the resolved mode for a context
 *
 * Modes are layered ABOVE ops.policy:
 *   - 'custom'         → delegate fully to the policy engine
 *   - 'auto_approve'   → bypass approval (deny still applies)
 *   - 'ask_every_time' → force every allow to become approve
 *   - 'planning'       → behaves like ask_every_time in v1; future Sprint
 *                         5.3 will return a plan-only preview
 *
 * Resolution walks scope_kind in priority order skill → agent → department
 * → org. See apps/paperclip/src/autonomy/resolve.ts.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { resolveAutonomy } from "../autonomy/resolve.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import {
  AutonomyModeUpsert,
  AutonomyResolveQuery,
} from "../schemas.js";

type AutonomyRow = {
  id: string;
  org_id: string;
  scope_kind: string;
  scope_id: string | null;
  mode: string;
  spending_cap_cents: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  "id, org_id, scope_kind, scope_id, mode, spending_cap_cents, notes, created_at, updated_at";

export async function autonomyRoutes(app: FastifyInstance): Promise<void> {
  // -- list ---------------------------------------------------------------
  app.get("/api/autonomy", async (req) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<AutonomyRow>(
        `SELECT ${COLUMNS}
           FROM ops.autonomy_mode
          WHERE org_id = $1
          ORDER BY
            CASE scope_kind
              WHEN 'org' THEN 0
              WHEN 'department' THEN 1
              WHEN 'agent' THEN 2
              WHEN 'skill' THEN 3
            END,
            updated_at DESC`,
        [scope.org_id],
      );
      return rows;
    });
  });

  // -- upsert -------------------------------------------------------------
  // PUT instead of POST because the (org, scope_kind, scope_id) tuple is
  // the natural identity — there's at most one mode row per scope.
  app.put("/api/autonomy", async (req, reply) => {
    const parsed = AutonomyModeUpsert.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const { scope_kind, scope_id, mode, spending_cap_cents, notes } = parsed.data;
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      // Two SQL paths because the unique index is partial: scope_kind='org'
      // collides on (org_id), everything else collides on (org_id, kind, id).
      let row: AutonomyRow;
      if (scope_kind === "org") {
        const { rows } = await client.query<AutonomyRow>(
          `INSERT INTO ops.autonomy_mode
             (org_id, scope_kind, scope_id, mode, spending_cap_cents, notes)
           VALUES ($1, 'org', NULL, $2, $3, $4)
           ON CONFLICT (org_id) WHERE scope_kind = 'org'
             DO UPDATE SET
               mode               = EXCLUDED.mode,
               spending_cap_cents = EXCLUDED.spending_cap_cents,
               notes              = EXCLUDED.notes,
               updated_at         = now()
           RETURNING ${COLUMNS}`,
          [scope.org_id, mode, spending_cap_cents ?? null, notes ?? null],
        );
        row = rows[0]!;
      } else {
        const { rows } = await client.query<AutonomyRow>(
          `INSERT INTO ops.autonomy_mode
             (org_id, scope_kind, scope_id, mode, spending_cap_cents, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (org_id, scope_kind, scope_id) WHERE scope_kind <> 'org'
             DO UPDATE SET
               mode               = EXCLUDED.mode,
               spending_cap_cents = EXCLUDED.spending_cap_cents,
               notes              = EXCLUDED.notes,
               updated_at         = now()
           RETURNING ${COLUMNS}`,
          [scope.org_id, scope_kind, scope_id, mode, spending_cap_cents ?? null, notes ?? null],
        );
        row = rows[0]!;
      }
      await audit(
        {
          scope,
          action: "autonomy.upsert",
          target_type: "autonomy_mode",
          target_id: row.id,
          metadata: {
            scope_kind: row.scope_kind,
            scope_id: row.scope_id,
            mode: row.mode,
            spending_cap_cents: row.spending_cap_cents,
          },
        },
        client,
      );
      return row;
    });
    return reply.code(200).send(result);
  });

  // -- delete -------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/api/autonomy/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<{
        id: string;
        scope_kind: string;
        scope_id: string | null;
        mode: string;
      }>(
        `DELETE FROM ops.autonomy_mode
          WHERE id = $1 AND org_id = $2
          RETURNING id, scope_kind, scope_id, mode`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "autonomy.delete",
          target_type: "autonomy_mode",
          target_id: row.id,
          metadata: {
            scope_kind: row.scope_kind,
            scope_id: row.scope_id,
            mode: row.mode,
          },
        },
        client,
      );
      return row;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // -- resolve preview ----------------------------------------------------
  // Debug helper: given (department_id?, agent_id?, skill_id?), return the
  // mode that would apply. Backs the Settings tab's "what would happen
  // for skill X under agent Y?" preview.
  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/api/autonomy/resolve",
    async (req, reply) => {
      const parsed = AutonomyResolveQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
      }
      const scope = await resolveCallerScope(req);
      return withOrgScope(scope.org_id, async (client) => {
        return resolveAutonomy(client, {
          orgId: scope.org_id,
          departmentId: parsed.data.department_id ?? null,
          agentId: parsed.data.agent_id ?? null,
          skillId: parsed.data.skill_id ?? null,
        });
      });
    },
  );
}
