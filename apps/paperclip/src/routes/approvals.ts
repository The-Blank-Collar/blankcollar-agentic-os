/**
 * Approvals API — the agent ↔ human pause-and-decide protocol.
 *
 *   POST   /api/approvals                 agent creates a proposal
 *   GET    /api/approvals?status=pending  list (default: pending)
 *   GET    /api/approvals/:id             single proposal
 *   POST   /api/approvals/:id/approve     human approves; agent run resumes
 *   POST   /api/approvals/:id/decline     human declines; run is marked failed
 *
 * v0 stores the full proposal in ops.approval. Resolution writes to the
 * audit log and (when run_id is set) flips the run's status — succeeded on
 * approve, failed on decline. Phase 5 wires the agent loop to await the
 * resolution before continuing; for now agents propose and stop.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import { ApprovalCreate, ApprovalListQuery, ApprovalResolve } from "../schemas.js";

type ApprovalRow = {
  id: string;
  org_id: string;
  goal_id: string | null;
  run_id: string | null;
  requesting_agent_id: string | null;
  action_kind: string;
  proposal: Record<string, unknown>;
  reason: string | null;
  urgency: "low" | "normal" | "urgent";
  expires_at: string | null;
  resolution: "approved" | "declined" | "expired" | null;
  resolved_by_user_id: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

const APPROVAL_COLUMNS = `
  id, org_id, goal_id, run_id, requesting_agent_id, action_kind,
  proposal, reason, urgency, expires_at, resolution,
  resolved_by_user_id, resolved_at, resolution_note, created_at
`;

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  // -- create -------------------------------------------------------------
  app.post("/api/approvals", async (req, reply) => {
    const parsed = ApprovalCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const expiresAt = parsed.data.expires_in_hours
      ? new Date(Date.now() + parsed.data.expires_in_hours * 3_600_000).toISOString()
      : null;
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<ApprovalRow>(
        `INSERT INTO ops.approval (
           org_id, goal_id, run_id, requesting_agent_id, action_kind,
           proposal, reason, urgency, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::ops.approval_urgency, $9)
         RETURNING ${APPROVAL_COLUMNS}`,
        [
          scope.org_id,
          parsed.data.goal_id ?? null,
          parsed.data.run_id ?? null,
          parsed.data.requesting_agent_id ?? null,
          parsed.data.action_kind,
          JSON.stringify(parsed.data.proposal),
          parsed.data.reason ?? null,
          parsed.data.urgency,
          expiresAt,
        ],
      );
      const approval = rows[0]!;

      // If a run is referenced, mark it paused so the worker stops polling.
      // (For v0 the worker doesn't yet see this state; the column flip is
      // a clean signal for the future agent-await loop.)
      if (approval.run_id) {
        await client.query(
          `UPDATE ops.run SET status = 'queued' WHERE id = $1 AND status = 'running'`,
          [approval.run_id],
        );
      }
      await audit(
        {
          scope,
          action: "approval.create",
          target_type: "approval",
          target_id: approval.id,
          metadata: {
            action_kind: approval.action_kind,
            urgency: approval.urgency,
            run_id: approval.run_id,
            goal_id: approval.goal_id,
          },
        },
        client,
      );
      return approval;
    });
    return reply.code(201).send(result);
  });

  // -- list ---------------------------------------------------------------
  app.get("/api/approvals", async (req, reply) => {
    const parsed = ApprovalListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const where: string[] = ["org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (parsed.data.status === "pending") {
      where.push("resolution IS NULL");
    } else if (parsed.data.status === "resolved") {
      where.push("resolution IS NOT NULL");
    }
    if (parsed.data.urgency) {
      params.push(parsed.data.urgency);
      where.push(`urgency = $${params.length}::ops.approval_urgency`);
    }
    params.push(parsed.data.limit);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<ApprovalRow>(
        `SELECT ${APPROVAL_COLUMNS}
           FROM ops.approval
          WHERE ${where.join(" AND ")}
          ORDER BY
            CASE urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
            created_at DESC
          LIMIT $${params.length}`,
        params,
      );
      return rows;
    });
  });

  // -- summary ------------------------------------------------------------
  // Counts per urgency, plus 7-day approve/decline rates. Backs the
  // governance rail and bc approvals --summary.
  app.get("/api/approvals/summary", async (req) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<{
        pending_total: string;
        pending_urgent: string;
        pending_normal: string;
        pending_low: string;
        approved_7d: string;
        declined_7d: string;
        expired_7d: string;
      }>(
        `SELECT
            COUNT(*) FILTER (WHERE resolution IS NULL
                              AND (expires_at IS NULL OR expires_at > now()))::text  AS pending_total,
            COUNT(*) FILTER (WHERE resolution IS NULL AND urgency = 'urgent'
                              AND (expires_at IS NULL OR expires_at > now()))::text  AS pending_urgent,
            COUNT(*) FILTER (WHERE resolution IS NULL AND urgency = 'normal'
                              AND (expires_at IS NULL OR expires_at > now()))::text  AS pending_normal,
            COUNT(*) FILTER (WHERE resolution IS NULL AND urgency = 'low'
                              AND (expires_at IS NULL OR expires_at > now()))::text  AS pending_low,
            COUNT(*) FILTER (WHERE resolution = 'approved'
                              AND resolved_at > now() - interval '7 days')::text     AS approved_7d,
            COUNT(*) FILTER (WHERE resolution = 'declined'
                              AND resolved_at > now() - interval '7 days')::text     AS declined_7d,
            COUNT(*) FILTER (WHERE resolution IS NULL
                              AND expires_at IS NOT NULL
                              AND expires_at < now() - interval '7 days')::text      AS expired_7d
           FROM ops.approval
          WHERE org_id = $1`,
        [scope.org_id],
      );
      const r = rows[0]!;
      return {
        pending: {
          total: Number(r.pending_total ?? "0"),
          urgent: Number(r.pending_urgent ?? "0"),
          normal: Number(r.pending_normal ?? "0"),
          low: Number(r.pending_low ?? "0"),
        },
        recent: {
          approved_7d: Number(r.approved_7d ?? "0"),
          declined_7d: Number(r.declined_7d ?? "0"),
          expired_7d: Number(r.expired_7d ?? "0"),
        },
      };
    });
  });

  // -- get ----------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/approvals/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const rows = await withOrgScope(scope.org_id, async (client) => {
      const { rows: rs } = await client.query<ApprovalRow>(
        `SELECT ${APPROVAL_COLUMNS} FROM ops.approval WHERE id = $1 AND org_id = $2`,
        [req.params.id, scope.org_id],
      );
      return rs;
    });
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });

  // -- approve ------------------------------------------------------------
  app.post<{ Params: { id: string } }>("/api/approvals/:id/approve", async (req, reply) =>
    resolveApproval(req, reply, "approved"),
  );

  // -- decline ------------------------------------------------------------
  app.post<{ Params: { id: string } }>("/api/approvals/:id/decline", async (req, reply) =>
    resolveApproval(req, reply, "declined"),
  );

  async function resolveApproval(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
    resolution: "approved" | "declined",
  ): Promise<unknown> {
    const parsed = ApprovalResolve.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<ApprovalRow>(
        `SELECT ${APPROVAL_COLUMNS} FROM ops.approval
          WHERE id = $1 AND org_id = $2 FOR UPDATE`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return { kind: "not_found" as const };
      const approval = rows[0]!;
      if (approval.resolution) {
        return { kind: "already_resolved" as const, current: approval.resolution };
      }
      const { rows: updated } = await client.query<ApprovalRow>(
        `UPDATE ops.approval
            SET resolution = $2::ops.approval_resolution,
                resolved_at = now(),
                resolution_note = $3
          WHERE id = $1
          RETURNING ${APPROVAL_COLUMNS}`,
        [approval.id, resolution, parsed.data.note ?? null],
      );

      // Flip the originating run, if any. Approve → succeeded, decline → failed.
      // Phase 5 will instead resume a paused run with the resolution as input;
      // for now the terminal state is the cleanest signal for the rest of the
      // pipeline (heartbeat, audit, inbox).
      if (approval.run_id) {
        const newStatus = resolution === "approved" ? "succeeded" : "failed";
        await client.query(
          `UPDATE ops.run
              SET status = $2::ops.run_status,
                  finished_at = COALESCE(finished_at, now()),
                  output = COALESCE(output, $3::jsonb)
            WHERE id = $1`,
          [
            approval.run_id,
            newStatus,
            JSON.stringify({ approval_id: approval.id, resolution, note: parsed.data.note }),
          ],
        );
      } else if (
        resolution === "approved" &&
        approval.action_kind.startsWith("skill.") &&
        approval.proposal &&
        typeof approval.proposal === "object" &&
        "skill" in approval.proposal &&
        "agent_kind" in approval.proposal
      ) {
        // Policy-gated skill invocation: the original /api/skills/:slug/invoke
        // call returned 202 with the approval_id but no run_id. On approve,
        // we now queue the run from the cached proposal so the worker
        // picks it up.
        const p = approval.proposal as {
          goal_id: string;
          skill: string;
          agent_kind: string;
          inputs: Record<string, unknown>;
        };
        const { rows: runRows } = await client.query<{ id: string }>(
          `INSERT INTO ops.run (goal_id, status, input)
           VALUES ($1, 'queued', $2::jsonb)
           RETURNING id`,
          [
            p.goal_id,
            JSON.stringify({ skill: p.skill, agent_kind: p.agent_kind, inputs: p.inputs }),
          ],
        );
        const runId = runRows[0]!.id;
        // Backfill the run_id on the approval so the inbox can link to it.
        await client.query(
          "UPDATE ops.approval SET run_id = $2 WHERE id = $1",
          [approval.id, runId],
        );
      }

      await audit(
        {
          scope,
          action: resolution === "approved" ? "approval.approve" : "approval.decline",
          target_type: "approval",
          target_id: approval.id,
          metadata: {
            action_kind: approval.action_kind,
            run_id: approval.run_id,
            note: parsed.data.note ?? null,
          },
        },
        client,
      );
      return { kind: "ok" as const, approval: updated[0]! };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.kind === "already_resolved") {
      return reply.code(409).send({ error: "already_resolved", current_resolution: result.current });
    }
    return result.approval;
  }
}
