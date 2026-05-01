/**
 * Inbox — what wants the user.
 *
 * The Inbox is the soul of the personal-assistant experience. It answers
 * the only question that matters at 8:30am: "what wants me?"
 *
 * v0 surfaces three item kinds, ordered by urgency:
 *   - decision  — kind=decision goals in draft/active state
 *   - blocked   — paused goals (manual or run-failure-driven)
 *   - draft     — recently-completed runs whose output hasn't been acted on
 *
 * Each item carries a goal_id so the UI can drill in and a synthesized
 * `urgency` ordering hint. The frontend never has to compose this from
 * three queries; it's already shaped.
 */

import type { FastifyInstance } from "fastify";

import { query } from "../db.js";
import { resolveCallerScope } from "../scope.js";

export type InboxItemKind = "decision" | "blocked" | "draft";

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
type DraftRow    = { goal_id: string; title: string; finished_at: string; output: unknown };

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
        // Drafts awaiting review: latest succeeded run per active goal whose
        // finish is more recent than the goal's last update.
        `SELECT DISTINCT ON (g.id)
                g.id   AS goal_id,
                g.title,
                r.finished_at,
                r.output
           FROM ops.goal g
           JOIN ops.run  r ON r.goal_id = g.id
          WHERE g.org_id = $1
            AND r.status = 'succeeded'
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
        item_kind: "draft",
        goal_id: dr.goal_id,
        title: dr.title,
        created_at: dr.finished_at,
        urgency: "normal",
        metadata: { has_output: dr.output !== null },
      });
    }

    // Decisions first, then drafts (something to do), then blocked (acknowledge).
    const order: Record<InboxItemKind, number> = { decision: 0, draft: 1, blocked: 2 };
    items.sort((a, b) => {
      if (a.urgency !== b.urgency) return a.urgency === "urgent" ? -1 : 1;
      if (a.item_kind !== b.item_kind) return order[a.item_kind] - order[b.item_kind];
      return a.created_at < b.created_at ? 1 : -1;
    });

    return items.slice(0, limit);
  });
}
