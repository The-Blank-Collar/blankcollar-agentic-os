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

import {
  createBillingPortalSession,
  createCheckoutSession,
  StripeApiError,
} from "../billing/checkout.js";
import { getSubscriptionForOrg } from "../billing/subscription.js";
import { resolveCallerScope } from "../scope.js";

type PricingPlan = {
  tier: "pro" | "studio";
  name: string;
  price_id: string;
  /** Headline price string for the UI — purely cosmetic. */
  price_display: string;
  /** Stripe interval: month | year. */
  interval: "month" | "year";
  highlights: string[];
};

/**
 * Build the pricing plan catalog from env. Each tier's price id is a
 * separate var so the operator wires Stripe Dashboard → Products into
 * the deployment without code changes.
 */
function pricingPlans(): PricingPlan[] {
  const out: PricingPlan[] = [];
  const proId = process.env.STRIPE_PRICE_ID_PRO?.trim();
  const studioId = process.env.STRIPE_PRICE_ID_STUDIO?.trim();
  if (proId) {
    out.push({
      tier: "pro",
      name: "Pro",
      price_id: proId,
      price_display: process.env.STRIPE_PRICE_DISPLAY_PRO ?? "$49 / mo",
      interval: "month",
      highlights: [
        "Unlimited goals & captures",
        "Up to 5 agents",
        "All channels (Telegram, Slack, Email)",
        "Daily briefings + heartbeat",
      ],
    });
  }
  if (studioId) {
    out.push({
      tier: "studio",
      name: "Studio",
      price_id: studioId,
      price_display: process.env.STRIPE_PRICE_DISPLAY_STUDIO ?? "$199 / mo",
      interval: "month",
      highlights: [
        "Everything in Pro",
        "Unlimited agents",
        "Knowledge base + connectors",
        "Priority support",
      ],
    });
  }
  return out;
}

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

  app.get("/api/billing/plans", async () => {
    return { plans: pricingPlans() };
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

  // -- create checkout session ------------------------------------------
  // Caller picks a tier; we resolve the price id from env, build a
  // Stripe Checkout Session with `metadata.org_id` so the webhook lands
  // the subscription on the right row, and return the redirect URL.
  app.post<{ Body: { tier?: string; success_url?: string; cancel_url?: string } }>(
    "/api/billing/checkout",
    async (req, reply) => {
      if (!process.env.STRIPE_SECRET_KEY) {
        return reply.code(503).send({
          error: "stripe_not_configured",
          hint: "Set STRIPE_SECRET_KEY + STRIPE_PRICE_ID_PRO/STUDIO in .env.",
        });
      }
      const scope = await resolveCallerScope(req);
      const auth = req.bcAuth;
      const email = auth?.email ?? "";
      if (!email) {
        return reply.code(400).send({
          error: "missing_email",
          hint: "Checkout requires an authenticated user with a verified email.",
        });
      }

      const body = (req.body ?? {}) as { tier?: string; success_url?: string; cancel_url?: string };
      const tier = (body.tier ?? "pro").toLowerCase();
      const plan = pricingPlans().find((p) => p.tier === tier);
      if (!plan) {
        return reply.code(400).send({
          error: "unknown_tier",
          hint: "Available tiers: " + pricingPlans().map((p) => p.tier).join(", "),
        });
      }

      const sub = await getSubscriptionForOrg(scope.org_id);
      const baseUrl = (process.env.WEBSITE_PUBLIC_URL?.split(",")[0] ?? "http://localhost:3000")
        .replace(/\/+$/, "");
      const successUrl = body.success_url
        ?? `${baseUrl}/?billing=success&session={CHECKOUT_SESSION_ID}`;
      const cancelUrl = body.cancel_url
        ?? `${baseUrl}/?billing=cancelled`;

      try {
        const session = await createCheckoutSession({
          org_id: scope.org_id,
          email,
          price_id: plan.price_id,
          success_url: successUrl,
          cancel_url: cancelUrl,
          customer_id: sub.stripe_customer_id ?? null,
          mode: "subscription",
        });
        return reply.send({
          session_id: session.id,
          url: session.url,
          tier: plan.tier,
        });
      } catch (err) {
        const message = err instanceof StripeApiError ? err.message : (err as Error).message;
        req.log.error({ err, tier }, "checkout session create failed");
        return reply.code(502).send({ error: "stripe_error", detail: message });
      }
    },
  );

  // -- create billing portal session -----------------------------------
  // Returns the redirect URL to Stripe's customer portal. Requires that
  // the org already has a stripe_customer_id (i.e. has subscribed at
  // least once); otherwise the caller should hit /checkout instead.
  app.post<{ Body: { return_url?: string } }>(
    "/api/billing/portal",
    async (req, reply) => {
      if (!process.env.STRIPE_SECRET_KEY) {
        return reply.code(503).send({
          error: "stripe_not_configured",
          hint: "Set STRIPE_SECRET_KEY in .env.",
        });
      }
      const scope = await resolveCallerScope(req);
      const sub = await getSubscriptionForOrg(scope.org_id);
      if (!sub.stripe_customer_id) {
        return reply.code(409).send({
          error: "no_customer",
          hint: "This org has no Stripe customer yet — start at /api/billing/checkout.",
        });
      }
      const baseUrl = (process.env.WEBSITE_PUBLIC_URL?.split(",")[0] ?? "http://localhost:3000")
        .replace(/\/+$/, "");
      const body = (req.body ?? {}) as { return_url?: string };
      const returnUrl = body.return_url ?? `${baseUrl}/?billing=portal-return`;
      try {
        const session = await createBillingPortalSession({
          customer_id: sub.stripe_customer_id,
          return_url: returnUrl,
        });
        return reply.send({ url: session.url });
      } catch (err) {
        const message = err instanceof StripeApiError ? err.message : (err as Error).message;
        req.log.error({ err }, "portal session create failed");
        return reply.code(502).send({ error: "stripe_error", detail: message });
      }
    },
  );
}
