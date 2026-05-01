/**
 * Inbox — what wants the user.
 *
 * The Inbox is the soul of the personal-assistant experience. It answers
 * the only question that matters at 8:30am: "what wants me?"
 *
 * v0 surfaces five item kinds, ordered by urgency:
 *   - approval        — agent proposed a side-effecting action; awaiting decision
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
 * for that goal as seen. Approvals resolve via /api/approvals/:id/{approve,decline}.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { query, tx } from "../db.js";
import { resolveCallerScope } from "../scope.js";

export type InboxItemKind = "approval" | "decision" | "blocked" | "routine_output" | "draft";

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
type ApprovalRowSummary = {
  id: string;
  goal_id: string | null;
  action_kind: string;
  reason: string | null;
  urgency: "low" | "normal" | "urgent";
  created_at: string;
};

const DEFAULT_LIMIT = 20;

export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>("/api/inbox", async (req) => {
    const scope = await resolveCallerScope(req);
    const limit = Math.min(Math.max(Number(req.query.limit ?? DEFAULT_LIMIT), 1), 100);

    const [approvals, decisions, blocked, drafts] = await Promise.all([
      query<ApprovalRowSummary>(
        `SELECT id, goal_id, action_kind, reason, urgency, created_at
           FROM ops.approval
          WHERE org_id = $1
            AND resolution IS NULL
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY
            CASE urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
            created_at DESC
          LIMIT $2`,
        [scope.org_id, limit],
      ),
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

    for (const a of approvals.rows) {
      // Approvals get goal_id when one is referenced; otherwise the
      // approval id stands in. The frontend opens /api/approvals/:id with
      // metadata.approval_id either way.
      items.push({
        item_kind: "approval",
        goal_id: a.goal_id ?? a.id,
        title: humaniseAction(a.action_kind, a.reason),
        created_at: a.created_at,
        urgency: a.urgency === "urgent" ? "urgent" : "normal",
        metadata: {
          approval_id: a.id,
          action_kind: a.action_kind,
        },
      });
    }

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

    // Approvals are loudest (an agent literally paused waiting), then
    // decisions (you must choose), then routine outputs (today's digest),
    // then drafts (something to review), then blocked (just acknowledge).
    const order: Record<InboxItemKind, number> = {
      approval: 0,
      decision: 1,
      routine_output: 2,
      draft: 3,
      blocked: 4,
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
  // by un-pausing the underlying goal; approvals resolve via /api/approvals.
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

function humaniseAction(actionKind: string, reason: string | null): string {
  // The action_kind is dotted (skill.email.send, payment.charge,
  // hire.extend_offer) — turn it into one short clause.
  const segments = actionKind.split(".");
  const last = segments[segments.length - 1] ?? actionKind;
  const verb = last.replace(/_/g, " ");
  if (reason && reason.length > 0) {
    return `${verb} — ${reason.slice(0, 120)}`;
  }
  return verb.charAt(0).toUpperCase() + verb.slice(1);
}
