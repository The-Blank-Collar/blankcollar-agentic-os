/**
 * Billing — Phase 7.b.
 *
 *   GET /api/billing/subscription   current subscription state for caller's org
 *   GET /api/billing/portal-url     Stripe customer-portal redirect URL
 *
 * Subscription state is materialized into `billing.subscription` by the
 * Stripe webhook handler. Orgs that have never bought anything get a
 * synthetic "free tier" row from `freeTier()` so the frontend renders
 * a consistent shape.
 *
 * The portal URL is surfaced through env (`STRIPE_BILLING_PORTAL_URL`)
 * so OSS local installs can paste a no-code Stripe-hosted portal link;
 * paid SaaS deploys can swap in a per-customer Stripe.billingPortal
 * session URL later without changing the wire shape.
 */

import type { FastifyInstance } from "fastify";

import { getSubscriptionForOrg } from "../billing/subscription.js";
import { resolveCallerScope } from "../scope.js";

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/billing/subscription", async (req) => {
    const scope = await resolveCallerScope(req);
    const row = await getSubscriptionForOrg(scope.org_id);
    return {
      ...row,
      // Convenience flag for the UI — most call-sites only care about this.
      is_free: row.tier === "free",
    };
  });

  app.get("/api/billing/portal-url", async (req) => {
    const scope = await resolveCallerScope(req);
    const portalUrl = process.env.STRIPE_BILLING_PORTAL_URL?.trim() || null;
    const checkoutUrl = process.env.STRIPE_CHECKOUT_URL?.trim() || null;
    const sub = await getSubscriptionForOrg(scope.org_id);
    return {
      portal_url: portalUrl,
      checkout_url: checkoutUrl,
      configured: Boolean(portalUrl || checkoutUrl),
      tier: sub.tier,
    };
  });
}
