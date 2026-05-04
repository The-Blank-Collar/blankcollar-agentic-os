/**
 * Tier gating — Phase 7.b sibling of subscription.ts.
 *
 * Gives route handlers a `requireTier(scope, "pro")` style check that:
 *   - Always returns allowed=true when BLANKCOLLAR_BILLING_ENFORCE != "true".
 *     OSS local mode and self-hosted installs stay open by default.
 *   - When enforcement is on, reads the org's subscription via
 *     getSubscriptionForOrg() and compares against TIER_RANK.
 *   - Returns a structured result so the caller decides the response shape
 *     (most callers will reply 402 when allowed=false).
 *
 * Tier hierarchy is intentionally short — adding a new tier means adding
 * one entry here. Names are arbitrary strings; the rank determines order.
 */

import type { Scope } from "../schemas.js";
import { getSubscriptionForOrg, type SubscriptionRow } from "./subscription.js";

const TIER_RANK: Record<string, number> = {
  free:       0,
  pro:        10,
  studio:     20,
  enterprise: 30,
};

const ACTIVE_STATUSES: ReadonlySet<SubscriptionRow["status"]> = new Set([
  "active",
  "trialing",
  "past_due", // grace period — still serve paid features
]);

export type TierGateResult = {
  allowed: boolean;
  current: string;
  required: string;
  status: SubscriptionRow["status"];
  reason: string | null;
};

function rankFor(tier: string): number {
  return TIER_RANK[tier] ?? -1;
}

/**
 * Read-only check. The caller decides what to do with the result; this
 * keeps the helper composable (some routes 402, some downgrade to a
 * read-only response, some just log).
 */
export async function checkTier(
  scope: Pick<Scope, "org_id">,
  required: string,
): Promise<TierGateResult> {
  const enforce = (process.env.BLANKCOLLAR_BILLING_ENFORCE ?? "").toLowerCase() === "true";

  // OSS / self-hosted default: always allowed. The subscription is still
  // surfaced so the caller can log + audit if it wants.
  if (!enforce) {
    const sub = await getSubscriptionForOrg(scope.org_id);
    return {
      allowed: true,
      current: sub.tier,
      required,
      status: sub.status,
      reason: null,
    };
  }

  const sub = await getSubscriptionForOrg(scope.org_id);
  if (!ACTIVE_STATUSES.has(sub.status)) {
    return {
      allowed: false,
      current: sub.tier,
      required,
      status: sub.status,
      reason: `subscription_${sub.status}`,
    };
  }

  const have = rankFor(sub.tier);
  const need = rankFor(required);
  if (need < 0) {
    // Unknown tier required — fail closed.
    return {
      allowed: false,
      current: sub.tier,
      required,
      status: sub.status,
      reason: "unknown_required_tier",
    };
  }
  if (have >= need) {
    return {
      allowed: true,
      current: sub.tier,
      required,
      status: sub.status,
      reason: null,
    };
  }
  return {
    allowed: false,
    current: sub.tier,
    required,
    status: sub.status,
    reason: "insufficient_tier",
  };
}

/**
 * Convenience wrapper for the common pattern of "gate this whole route".
 * Caller passes a Fastify reply; on failure we 402 with a structured
 * payload and the caller short-circuits.
 *
 * Usage:
 *   if (await gateOr402(scope, "pro", reply)) return;  // 402 already sent
 *   // …protected work…
 */
export async function gateOr402(
  scope: Pick<Scope, "org_id">,
  required: string,
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
): Promise<boolean> {
  const result = await checkTier(scope, required);
  if (result.allowed) return false;
  reply.code(402).send({
    error: "payment_required",
    reason: result.reason,
    current_tier: result.current,
    required_tier: result.required,
    status: result.status,
    hint:
      "Set STRIPE_CHECKOUT_URL in .env to surface an upgrade link in " +
      "Settings → Billing. Disable gating with BLANKCOLLAR_BILLING_ENFORCE=false.",
  });
  return true;
}
