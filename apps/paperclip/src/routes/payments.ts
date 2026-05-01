/**
 * Payments — outbound spend safety primitives (Phase 9 backend prep).
 *
 *   GET  /api/payments/settings          singleton-per-org config
 *   PUT  /api/payments/settings          partial update
 *   GET  /api/payments/limits            per-agent caps
 *   POST /api/payments/limits            add a per-agent cap
 *   DELETE /api/payments/limits/:id      remove
 *   POST /api/payments/kill              flip kill switch ON, log event
 *   POST /api/payments/resume            flip kill switch OFF, log event
 *   POST /api/payments/request           create a pending payment request
 *                                        (gated by enabled, kill_switch,
 *                                         per-agent cap, period rollup,
 *                                         policy engine, approval_threshold)
 *   GET  /api/payments/requests          list (filter by status)
 *
 * The Stripe connector + Finance Agent live in a future cloud sprint —
 * this surface lays the locally-testable foundation. Approved requests
 * stay in status='approved' until the connector lands to execute them.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { evaluatePolicy } from "../policy/evaluate.js";
import { resolveCallerScope } from "../scope.js";
import {
  KillSwitchToggle,
  PaymentRequestCreate,
  PaymentSettingsPatch,
  SpendingLimitCreate,
} from "../schemas.js";

type SettingsRow = {
  org_id: string;
  enabled: boolean;
  kill_switch: boolean;
  default_limit_cents: string;
  default_period: "per_request" | "daily" | "weekly" | "monthly";
  approval_threshold: string;
  notify_email: string | null;
  updated_at: string;
};

type LimitRow = {
  id: string;
  org_id: string;
  agent_id: string;
  limit_cents: string;
  period: "per_request" | "daily" | "weekly" | "monthly";
  category: string | null;
  created_at: string;
};

type PaymentRow = {
  id: string;
  org_id: string;
  agent_id: string | null;
  goal_id: string | null;
  run_id: string | null;
  amount_cents: string;
  currency: string;
  vendor: string;
  category: string | null;
  description: string;
  status: string;
  approval_id: string | null;
  decided_reason: string | null;
  external_ref: string | null;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
};

const PR_COLUMNS =
  "id, org_id, agent_id, goal_id, run_id, amount_cents, currency, vendor, category, description, status, approval_id, decided_reason, external_ref, created_at, decided_at, executed_at";

function periodWindowStart(period: LimitRow["period"]): string {
  const now = new Date();
  switch (period) {
    case "daily":
      now.setUTCHours(0, 0, 0, 0);
      return now.toISOString();
    case "weekly": {
      const d = now.getUTCDay() || 7; // Mon=1 … Sun=7
      now.setUTCHours(0, 0, 0, 0);
      now.setUTCDate(now.getUTCDate() - (d - 1));
      return now.toISOString();
    }
    case "monthly":
      now.setUTCHours(0, 0, 0, 0);
      now.setUTCDate(1);
      return now.toISOString();
    case "per_request":
      // No window — every request is checked individually against limit.
      return new Date(0).toISOString();
  }
}

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  // -- settings -----------------------------------------------------------
  app.get("/api/payments/settings", async (req) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<SettingsRow>(
        "SELECT * FROM ops.payment_settings WHERE org_id = $1",
        [scope.org_id],
      );
      if (rows.length > 0) return shapeSettings(rows[0]!);
      // First read auto-creates the row with defaults so subsequent PUTs
      // have something to UPDATE. Idempotent — race is fine.
      const { rows: created } = await client.query<SettingsRow>(
        `INSERT INTO ops.payment_settings (org_id) VALUES ($1)
         ON CONFLICT (org_id) DO UPDATE SET org_id = EXCLUDED.org_id
         RETURNING *`,
        [scope.org_id],
      );
      return shapeSettings(created[0]!);
    });
  });

  app.put("/api/payments/settings", async (req, reply) => {
    const parsed = PaymentSettingsPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const sets: string[] = [];
      const params: unknown[] = [scope.org_id];
      const setCol = (col: string, val: unknown): void => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (parsed.data.enabled !== undefined)             setCol("enabled", parsed.data.enabled);
      if (parsed.data.default_limit_cents !== undefined) setCol("default_limit_cents", parsed.data.default_limit_cents);
      if (parsed.data.default_period !== undefined)      setCol("default_period", parsed.data.default_period);
      if (parsed.data.approval_threshold !== undefined)  setCol("approval_threshold", parsed.data.approval_threshold);
      if (parsed.data.notify_email !== undefined)        setCol("notify_email", parsed.data.notify_email);
      sets.push("updated_at = now()");

      const { rows } = await client.query<SettingsRow>(
        `INSERT INTO ops.payment_settings (org_id) VALUES ($1)
         ON CONFLICT (org_id) DO UPDATE SET ${sets.join(", ")}
         RETURNING *`,
        params,
      );
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "payments.settings.update",
          target_type: "payment_settings",
          target_id: row.org_id,
          metadata: parsed.data as Record<string, unknown>,
        },
        client,
      );
      return shapeSettings(row);
    });
    return result;
  });

  // -- limits -------------------------------------------------------------
  app.get("/api/payments/limits", async (req) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<LimitRow>(
        `SELECT * FROM ops.agent_spending_limit WHERE org_id = $1 ORDER BY created_at DESC`,
        [scope.org_id],
      );
      return rows.map(shapeLimit);
    });
  });

  app.post("/api/payments/limits", async (req, reply) => {
    const parsed = SpendingLimitCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<LimitRow>(
        `INSERT INTO ops.agent_spending_limit (org_id, agent_id, limit_cents, period, category)
         VALUES ($1, $2, $3, $4::ops.spending_period, $5)
         RETURNING *`,
        [
          scope.org_id,
          parsed.data.agent_id,
          parsed.data.limit_cents,
          parsed.data.period,
          parsed.data.category ?? null,
        ],
      );
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "payments.limit.create",
          target_type: "agent_spending_limit",
          target_id: row.id,
          metadata: { agent_id: row.agent_id, limit_cents: Number(row.limit_cents), period: row.period },
        },
        client,
      );
      return shapeLimit(row);
    });
    return reply.code(201).send(result);
  });

  app.delete<{ Params: { id: string } }>("/api/payments/limits/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `DELETE FROM ops.agent_spending_limit WHERE id = $1 AND org_id = $2 RETURNING id`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      await audit(
        { scope, action: "payments.limit.delete", target_type: "agent_spending_limit", target_id: rows[0]!.id, metadata: {} },
        client,
      );
      return rows[0];
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // -- kill switch --------------------------------------------------------
  app.post("/api/payments/kill", async (req, reply) =>
    flipKillSwitch(req, reply, true),
  );
  app.post("/api/payments/resume", async (req, reply) =>
    flipKillSwitch(req, reply, false),
  );

  async function flipKillSwitch(
    req: FastifyRequest,
    reply: FastifyReply,
    active: boolean,
  ): Promise<unknown> {
    const parsed = KillSwitchToggle.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      await client.query(
        `INSERT INTO ops.payment_settings (org_id, kill_switch)
         VALUES ($1, $2)
         ON CONFLICT (org_id) DO UPDATE SET kill_switch = EXCLUDED.kill_switch, updated_at = now()`,
        [scope.org_id, active],
      );
      const { rows } = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO ops.kill_switch_event (org_id, active, triggered_by, reason)
         VALUES ($1, $2, NULL, $3)
         RETURNING id, created_at`,
        [scope.org_id, active, parsed.data.reason ?? null],
      );
      await audit(
        {
          scope,
          action: active ? "payments.kill" : "payments.resume",
          target_type: "kill_switch_event",
          target_id: rows[0]!.id,
          metadata: { reason: parsed.data.reason ?? null },
        },
        client,
      );
      return { active, event_id: rows[0]!.id, at: rows[0]!.created_at };
    });
  }

  // -- request ------------------------------------------------------------
  // Records a payment request and decides its initial status:
  //   killed     — kill switch on (or settings.enabled=false)
  //   declined   — policy.deny OR exceeds the effective limit
  //   pending    — policy.approve OR amount >= settings.approval_threshold
  //                (an ops.approval row is created and linked)
  //   approved   — policy.allow + within limit + below threshold. The
  //                Stripe connector (Phase 9 cloud sprint) will pick this
  //                up and execute, transitioning to executing → succeeded.
  app.post("/api/payments/request", async (req, reply) => {
    const parsed = PaymentRequestCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);

    const result = await withOrgScope(scope.org_id, async (client) => {
      // 1. Settings — gates 1 & 2: enabled + kill switch.
      const { rows: settingsRows } = await client.query<SettingsRow>(
        `INSERT INTO ops.payment_settings (org_id) VALUES ($1)
         ON CONFLICT (org_id) DO UPDATE SET org_id = EXCLUDED.org_id
         RETURNING *`,
        [scope.org_id],
      );
      const settings = settingsRows[0]!;
      let initialStatus: PaymentRow["status"] = "approved";
      let reason: string | null = null;

      if (settings.kill_switch) {
        initialStatus = "killed";
        reason = "kill switch active";
      } else if (!settings.enabled) {
        initialStatus = "declined";
        reason = "payments disabled (operator hasn't enabled the spend layer)";
      }

      // 2. Per-agent cap + period rollup. Skipped if a prior gate already
      //    decided the request.
      let effectiveLimitCents = Number(settings.default_limit_cents);
      let effectivePeriod = settings.default_period;
      if (initialStatus === "approved" && parsed.data.agent_id) {
        const { rows: limitRows } = await client.query<LimitRow>(
          `SELECT * FROM ops.agent_spending_limit
            WHERE org_id = $1 AND agent_id = $2
              AND (category IS NULL OR category = $3)
            ORDER BY (category IS NULL) ASC, created_at DESC LIMIT 1`,
          [scope.org_id, parsed.data.agent_id, parsed.data.category ?? null],
        );
        if (limitRows.length > 0) {
          effectiveLimitCents = Number(limitRows[0]!.limit_cents);
          effectivePeriod = limitRows[0]!.period;
        }
        // Sum already-approved/executed spending in the active window.
        const winStart = periodWindowStart(effectivePeriod);
        const { rows: sumRows } = await client.query<{ spent: string | null }>(
          `SELECT COALESCE(SUM(amount_cents), 0)::text AS spent
             FROM ops.payment_request
            WHERE org_id = $1
              AND agent_id = $2
              AND status IN ('approved','executing','succeeded')
              AND created_at >= $3`,
          [scope.org_id, parsed.data.agent_id, winStart],
        );
        const spent = Number(sumRows[0]?.spent ?? "0");
        if (effectiveLimitCents === 0) {
          initialStatus = "declined";
          reason = "no spending allowed for this agent (limit=$0)";
        } else if (spent + parsed.data.amount_cents > effectiveLimitCents) {
          initialStatus = "declined";
          reason = `would exceed ${effectivePeriod} cap of ${effectiveLimitCents} cents (already spent ${spent})`;
        }
      }

      // 3. Policy engine — evaluator decides allow / approve / deny.
      if (initialStatus === "approved") {
        const decision = await evaluatePolicy(client, {
          orgId: scope.org_id,
          role: scope.role,
          actionKind: "payment.charge",
        });
        if (decision.effect === "deny") {
          initialStatus = "declined";
          reason = decision.matched?.reason ?? "denied by policy";
        } else if (decision.effect === "approve") {
          initialStatus = "pending";
          reason = decision.matched?.reason ?? "policy requires approval";
        }
      }

      // 4. approval_threshold — large amounts always require human review.
      const thresholdCents = Number(settings.approval_threshold);
      if (
        initialStatus === "approved" &&
        thresholdCents > 0 &&
        parsed.data.amount_cents >= thresholdCents
      ) {
        initialStatus = "pending";
        reason = `amount ≥ approval_threshold (${thresholdCents} cents)`;
      }

      // 5. Insert the row at its decided status.
      const { rows: prRows } = await client.query<PaymentRow>(
        `INSERT INTO ops.payment_request
            (org_id, agent_id, goal_id, run_id, amount_cents, currency,
             vendor, category, description, status, decided_reason, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 $10::ops.payment_status, $11,
                 CASE WHEN $10::ops.payment_status = 'pending' THEN NULL ELSE now() END)
         RETURNING ${PR_COLUMNS}`,
        [
          scope.org_id,
          parsed.data.agent_id ?? null,
          parsed.data.goal_id ?? null,
          parsed.data.run_id ?? null,
          parsed.data.amount_cents,
          parsed.data.currency,
          parsed.data.vendor,
          parsed.data.category ?? null,
          parsed.data.description,
          initialStatus,
          reason,
        ],
      );
      const row = prRows[0]!;

      // 6. If pending, create the approval row that surfaces in the inbox.
      if (initialStatus === "pending") {
        const { rows: appRows } = await client.query<{ id: string }>(
          `INSERT INTO ops.approval (
             org_id, action_kind, proposal, reason, urgency
           )
           VALUES ($1, 'payment.charge', $2::jsonb, $3,
                   CASE WHEN $4 >= 100000 THEN 'urgent'::ops.approval_urgency
                        ELSE 'normal'::ops.approval_urgency END)
           RETURNING id`,
          [
            scope.org_id,
            JSON.stringify({
              payment_request_id: row.id,
              amount_cents: parsed.data.amount_cents,
              currency: parsed.data.currency,
              vendor: parsed.data.vendor,
              category: parsed.data.category ?? null,
              description: parsed.data.description,
            }),
            reason,
            parsed.data.amount_cents,
          ],
        );
        await client.query(
          "UPDATE ops.payment_request SET approval_id = $2 WHERE id = $1",
          [row.id, appRows[0]!.id],
        );
        row.approval_id = appRows[0]!.id;
      }

      await audit(
        {
          scope,
          action: `payments.request.${initialStatus}`,
          target_type: "payment_request",
          target_id: row.id,
          metadata: {
            amount_cents: parsed.data.amount_cents,
            currency: parsed.data.currency,
            vendor: parsed.data.vendor,
            agent_id: parsed.data.agent_id ?? null,
            reason,
          },
        },
        client,
      );
      return shapePayment(row);
    });
    return reply.code(201).send(result);
  });

  // -- list ---------------------------------------------------------------
  app.get<{ Querystring: { status?: string; limit?: string } }>("/api/payments/requests", async (req) => {
    const scope = await resolveCallerScope(req);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
    const where: string[] = ["org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (req.query.status) {
      params.push(req.query.status);
      where.push(`status = $${params.length}::ops.payment_status`);
    }
    params.push(limit);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<PaymentRow>(
        `SELECT ${PR_COLUMNS} FROM ops.payment_request
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC
          LIMIT $${params.length}`,
        params,
      );
      return rows.map(shapePayment);
    });
  });
}

function shapeSettings(r: SettingsRow): Record<string, unknown> {
  return {
    org_id:              r.org_id,
    enabled:             r.enabled,
    kill_switch:         r.kill_switch,
    default_limit_cents: Number(r.default_limit_cents),
    default_period:      r.default_period,
    approval_threshold:  Number(r.approval_threshold),
    notify_email:        r.notify_email,
    updated_at:          r.updated_at,
  };
}

function shapeLimit(r: LimitRow): Record<string, unknown> {
  return {
    id:          r.id,
    org_id:      r.org_id,
    agent_id:    r.agent_id,
    limit_cents: Number(r.limit_cents),
    period:      r.period,
    category:    r.category,
    created_at:  r.created_at,
  };
}

function shapePayment(r: PaymentRow): Record<string, unknown> {
  return {
    id:             r.id,
    org_id:         r.org_id,
    agent_id:       r.agent_id,
    goal_id:        r.goal_id,
    run_id:         r.run_id,
    amount_cents:   Number(r.amount_cents),
    currency:       r.currency,
    vendor:         r.vendor,
    category:       r.category,
    description:    r.description,
    status:         r.status,
    approval_id:    r.approval_id,
    decided_reason: r.decided_reason,
    external_ref:   r.external_ref,
    created_at:     r.created_at,
    decided_at:     r.decided_at,
    executed_at:    r.executed_at,
  };
}
