/**
 * Goal Context (Phase 9.1).
 *
 * Per-goal markdown blob auto-loaded into every Hermes run scoped to
 * that goal_id. Closes the "agents forget the project context between
 * runs" gap. One row per goal (UNIQUE constraint), no version history,
 * no separate full-text index — agents read the whole thing every run.
 *
 *   GET /api/goals/:id/context     reads (returns synthetic empty doc if none)
 *   PUT /api/goals/:id/context     upserts; audited as goal.context_update
 *
 * Cap is enforced server-side at 8000 chars to keep the system-prompt
 * budget predictable. The UI shows a soft warning past 4000.
 */

import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";

const MAX_CHARS = 8000;

const GoalContextPut = z
  .object({ content_md: z.string().max(MAX_CHARS) })
  .strict();

type GoalContextRow = {
  id: string;
  org_id: string;
  goal_id: string;
  content_md: string;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  "id, org_id, goal_id, content_md, content_hash, created_at, updated_at";

function syntheticEmpty(orgId: string, goalId: string): GoalContextRow {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-0000-0000-000000000000",
    org_id: orgId,
    goal_id: goalId,
    content_md: "",
    content_hash: null,
    created_at: now,
    updated_at: now,
  };
}

export async function goalContextRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/goals/:id/context",
    async (req, reply) => {
      const scope = await resolveCallerScope(req);
      return withOrgScope(scope.org_id, async (client) => {
        // Verify goal belongs to caller's org — RLS would also block, but
        // the explicit check gives a clean 404 instead of an empty row.
        const { rows: own } = await client.query<{ id: string }>(
          "SELECT id FROM ops.goal WHERE id = $1 AND org_id = $2",
          [req.params.id, scope.org_id],
        );
        if (own.length === 0) {
          return reply.code(404).send({ error: "goal_not_found" });
        }
        const { rows } = await client.query<GoalContextRow>(
          `SELECT ${COLUMNS} FROM ops.goal_context WHERE goal_id = $1`,
          [req.params.id],
        );
        return rows[0] ?? syntheticEmpty(scope.org_id, req.params.id);
      });
    },
  );

  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/goals/:id/context",
    async (req, reply) => {
      const parsed = GoalContextPut.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_body",
          details: parsed.error.flatten(),
        });
      }
      const scope = await resolveCallerScope(req);
      const content = parsed.data.content_md;
      const hash = createHash("sha256").update(content).digest("hex");

      return withOrgScope(scope.org_id, async (client) => {
        const { rows: own } = await client.query<{ id: string }>(
          "SELECT id FROM ops.goal WHERE id = $1 AND org_id = $2",
          [req.params.id, scope.org_id],
        );
        if (own.length === 0) {
          return reply.code(404).send({ error: "goal_not_found" });
        }

        const { rows } = await client.query<GoalContextRow>(
          `INSERT INTO ops.goal_context (org_id, goal_id, content_md, content_hash)
             VALUES ($1, $2, $3, $4)
           ON CONFLICT (goal_id) DO UPDATE
             SET content_md   = EXCLUDED.content_md,
                 content_hash = EXCLUDED.content_hash,
                 updated_at   = now()
           RETURNING ${COLUMNS}`,
          [scope.org_id, req.params.id, content, hash],
        );
        const row = rows[0]!;
        await audit(
          {
            scope,
            action: "goal.context_update",
            target_type: "goal",
            target_id: req.params.id,
            metadata: { length: content.length, hash: hash.slice(0, 12) },
          },
          client,
        );
        return row;
      });
    },
  );
}
