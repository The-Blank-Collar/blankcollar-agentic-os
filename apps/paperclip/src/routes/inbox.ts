/**
 * Inbox — what wants the user.
 *
 * The Inbox is the soul of the personal-assistant experience. It answers
 * the only question that matters at 8:30am: "what wants me?"
 *
 * v0 surfaces four item kinds, ordered by urgency:
 *   - decision        — kind=decision goals in draft/active state
 *   - blocked         — paused goals (manual or run-failure-driven)
 *   - routine_output  — a routine fired and produced output (e.g. "your
 *                       Monday digest is ready")
 *   - draft           — recently-completed runs on standing/ephemeral goals
 *                       whose output hasn't been acknowledged
 *
 * Drafts and routine outputs are derived from succeeded runs whose
 * `acknowledged_at` is NULL — the user dismisses an item with
 * POST /api/inbox/acknowledge/:goal_id, which marks all unacknowledged runs
 * for that goal as seen.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { query, tx } from "../db.js";
import { resolveCallerScope } from "../scope.js";

export type InboxItemKind = "decision" | "blocked" | "routine_output" | "draft";

export type InboxItem = {
  item_kind: InboxItemKind;
  goal_id: string;
  title: string;
  created_at: string;
  urgency: "urgent" | "normal";
  metadata: Record<string, unknown>;
};

type DecisionRow = { id: string; title: string; created_at: string; due_at: string | null };
type BlockedRow  = { id: string; title: string; updated_at: string };
type DraftRow    = { goal_id: string; title: string; goal_kind: string; finished_at: string; output: unknown };

const DEFAULT_LIMIT = 20;

export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>("/api/inbox", async (req) => {
    const scope = await resolveCallerScope(req);
    const limit = Math.min(Math.max(Number(req.query.limit ?? DEFAULT_LIMIT), 1), 100);

    const [decisions, blocked, drafts] = await Promise.all([
      query<DecisionRow>(
        `SELECT id, title, created_at, due_at
           FROM ops.goal
          WHERE org_id = $1
            AND kind = 'decision'
            AND status IN ('draft','active')
          ORDER BY due_at NULLS LAST, created_at DESC
          LIMIT $2`,
        [scope.org_id, limit],
      ),
      query<BlockedRow>(
        `SELECT id, title, updated_at
           FROM ops.goal
          WHERE org_id = $1
            AND status = 'paused'
          ORDER BY updated_at DESC
          LIMIT $2`,
        [scope.org_id, limit],
      ),
      query<DraftRow>(
        // Drafts / routine outputs: latest unacknowledged succeeded run per
        // active goal. We carry goal.kind so the response can label routine
        // outputs distinctly from generic drafts.
        `SELECT DISTINCT ON (g.id)
                g.id     AS goal_id,
                g.title,
                g.kind   AS goal_kind,
                r.finished_at,
                r.output
           FROM ops.goal g
           JOIN ops.run  r ON r.goal_id = g.id
          WHERE g.org_id = $1
            AND r.status = 'succeeded'
            AND r.acknowledged_at IS NULL
            AND g.status IN ('active','draft')
          ORDER BY g.id, r.finished_at DESC
          LIMIT $2`,
        [scope.org_id, limit],
      ),
    ]);

    const items: InboxItem[] = [];

    const now = Date.now();
    for (const d of decisions.rows) {
      const due = d.due_at ? new Date(d.due_at).getTime() : null;
      const urgency: InboxItem["urgency"] = due && due - now < 48 * 3_600_000 ? "urgent" : "normal";
      items.push({
        item_kind: "decision",
        goal_id: d.id,
        title: d.title,
        created_at: d.created_at,
        urgency,
        metadata: { due_at: d.due_at },
      });
    }
    for (const b of blocked.rows) {
      items.push({
        item_kind: "blocked",
        goal_id: b.id,
        title: b.title,
        created_at: b.updated_at,
        urgency: "normal",
        metadata: { reason: "paused" },
      });
    }
    for (const dr of drafts.rows) {
      items.push({
        item_kind: dr.goal_kind === "routine" ? "routine_output" : "draft",
        goal_id: dr.goal_id,
        title: dr.title,
        created_at: dr.finished_at,
        urgency: "normal",
        metadata: { has_output: dr.output !== null, goal_kind: dr.goal_kind },
      });
    }

    // Decisions first (you must choose), then routine outputs (today's
    // digest), then drafts (something to review), then blocked (just
    // acknowledge).
    const order: Record<InboxItemKind, number> = {
      decision: 0,
      routine_output: 1,
      draft: 2,
      blocked: 3,
    };
    items.sort((a, b) => {
      if (a.urgency !== b.urgency) return a.urgency === "urgent" ? -1 : 1;
      if (a.item_kind !== b.item_kind) return order[a.item_kind] - order[b.item_kind];
      return a.created_at < b.created_at ? 1 : -1;
    });

    return items.slice(0, limit);
  });

  // -- acknowledge an inbox item -----------------------------------------
  // Marks every unacknowledged succeeded run for the given goal as seen,
  // removing it from the inbox's draft / routine_output stream. Decision
  // items use POST /api/goals/:id/resolve instead; blocked items unblock
  // by un-pausing the underlying goal.
  app.post<{ Params: { goal_id: string } }>("/api/inbox/acknowledge/:goal_id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await tx(async (client) => {
      const { rows: ownerCheck } = await client.query(
        "SELECT 1 FROM ops.goal WHERE id = $1 AND org_id = $2",
        [req.params.goal_id, scope.org_id],
      );
      if (ownerCheck.length === 0) return { kind: "not_found" as const };

      const { rowCount } = await client.query(
        `UPDATE ops.run
            SET acknowledged_at = now()
          WHERE goal_id = $1
            AND status = 'succeeded'
            AND acknowledged_at IS NULL`,
        [req.params.goal_id],
      );
      await audit(
        {
          scope,
          action: "inbox.acknowledge",
          target_type: "goal",
          target_id: req.params.goal_id,
          metadata: { runs_acknowledged: rowCount ?? 0 },
        },
        client,
      );
      return { kind: "ok" as const, runs_acknowledged: rowCount ?? 0 };
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    return result;
  });
}
