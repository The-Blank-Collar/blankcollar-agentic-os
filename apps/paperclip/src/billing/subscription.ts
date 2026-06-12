/**
 * Subscription state — materialized from Stripe webhooks.
 *
 * One row per (org, stripe_subscription_id). The webhook handler in
 * routes/webhooks.ts calls `applyStripeSubscriptionEvent()` after the
 * idempotent event-record step; that function maps Stripe's nested
 * subscription envelope onto our flat `billing.subscription` table.
 *
 * For OSS local mode + new orgs that haven't bought anything: there's
 * no row at all, and the API surfaces a synthetic "free tier" record.
 */

import type pg from "pg";

import { withOrgScope, withSystemScope } from "../db.js";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

const VALID_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

export type SubscriptionRow = {
  id: string;
  org_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  tier: string;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_end: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export const SUBSCRIPTION_COLUMNS =
  "id, org_id, stripe_customer_id, stripe_subscription_id, tier, status, " +
  "current_period_start, current_period_end, cancel_at_period_end, trial_end, " +
  "metadata, created_at, updated_at";

/**
 * Synthetic "free tier" row returned to the API when an org has never
 * connected Stripe. Keeps the UI single-shape (always render a row)
 * without forcing a DB write at first read.
 */
export function freeTier(orgId: string): SubscriptionRow {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-0000-0000-000000000000",
    org_id: orgId,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    tier: "free",
    status: "active",
    current_period_start: null,
    current_period_end: null,
    cancel_at_period_end: false,
    trial_end: null,
    metadata: { synthetic: true },
    created_at: now,
    updated_at: now,
  };
}

export async function getSubscriptionForOrg(orgId: string): Promise<SubscriptionRow> {
  return withOrgScope(orgId, async (client) => {
    const { rows } = await client.query<SubscriptionRow>(
      `SELECT ${SUBSCRIPTION_COLUMNS}
         FROM billing.subscription
        WHERE org_id = $1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [orgId],
    );
    return rows[0] ?? freeTier(orgId);
  });
}

// ---- Stripe envelope shape (only the fields we read) ---------------------

type StripePrice = {
  id?: string;
  lookup_key?: string;
  metadata?: Record<string, string> | null;
  product?: string | { id?: string; metadata?: Record<string, string> | null };
};

type StripeSubItem = {
  price?: StripePrice | null;
};

type StripeSubscription = {
  id?: string;
  customer?: string | null;
  status?: string;
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  trial_end?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data?: StripeSubItem[] };
};

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: StripeSubscription };
};

function tierFromSubscription(sub: StripeSubscription): string {
  // Tier resolution — first match wins:
  //   1. subscription.metadata.tier
  //   2. price.metadata.tier (first item)
  //   3. price.lookup_key (first item)
  //   4. fallback "paid"
  const subMeta = sub.metadata?.tier;
  if (subMeta) return subMeta;
  const items = sub.items?.data ?? [];
  for (const item of items) {
    const price = item.price;
    if (!price) continue;
    if (price.metadata?.tier) return price.metadata.tier;
    if (price.lookup_key) return price.lookup_key;
  }
  return "paid";
}

function isoOrNull(unix: number | null | undefined): string | null {
  if (typeof unix !== "number" || !Number.isFinite(unix)) return null;
  return new Date(unix * 1000).toISOString();
}

function statusOrFallback(s: string | undefined): SubscriptionStatus {
  if (s && VALID_STATUSES.has(s as SubscriptionStatus)) return s as SubscriptionStatus;
  return "incomplete";
}

/**
 * Resolve the org_id for a Stripe subscription. Strategy:
 *   1. Look up an existing billing.subscription row by stripe_subscription_id.
 *   2. Look up by stripe_customer_id (subscription created earlier).
 *   3. Fall back to subscription.metadata.org_id (set when the operator
 *      configures their checkout link).
 * Returns null if no mapping is known yet — the event is recorded in
 * billing.stripe_event for replay once the operator wires their
 * customer_id, but no subscription row is created.
 */
async function resolveOrgIdForSubscription(
  client: pg.PoolClient,
  sub: StripeSubscription,
): Promise<string | null> {
  if (sub.id) {
    const { rows } = await client.query<{ org_id: string }>(
      "SELECT org_id FROM billing.subscription WHERE stripe_subscription_id = $1",
      [sub.id],
    );
    if (rows[0]) return rows[0].org_id;
  }
  if (sub.customer) {
    const { rows } = await client.query<{ org_id: string }>(
      "SELECT org_id FROM billing.subscription WHERE stripe_customer_id = $1 LIMIT 1",
      [sub.customer],
    );
    if (rows[0]) return rows[0].org_id;
  }
  const metaOrg = sub.metadata?.org_id;
  if (metaOrg) {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM core.organization WHERE id = $1",
      [metaOrg],
    );
    if (rows[0]) return rows[0].id;
  }
  return null;
}

/**
 * Apply a Stripe `customer.subscription.{created,updated,deleted}` event
 * to the local `billing.subscription` table. Idempotent — re-applying
 * the same event yields the same row.
 *
 * Returns the materialized row, or null when no org mapping was found
 * (in which case the event is dropped on the floor; replay it after
 * wiring the org_id).
 */
export async function applyStripeSubscriptionEvent(
  event: StripeEvent,
): Promise<SubscriptionRow | null> {
  const sub = event.data?.object;
  const type = event.type ?? "";
  if (!sub || !type.startsWith("customer.subscription.")) return null;

  // System scope — we don't yet know which org this subscription belongs
  // to until we look it up. Once resolved, we re-bind to the org for any
  // downstream audit() call.
  return withSystemScope(async (client) => {
    const orgId = await resolveOrgIdForSubscription(client, sub);
    if (!orgId) return null;

    const status = type === "customer.subscription.deleted"
      ? "canceled"
      : statusOrFallback(sub.status);
    const tier = type === "customer.subscription.deleted"
      ? "free"
      : tierFromSubscription(sub);

    const { rows } = await client.query<SubscriptionRow>(
      `INSERT INTO billing.subscription
         (org_id, stripe_customer_id, stripe_subscription_id, tier, status,
          current_period_start, current_period_end, cancel_at_period_end,
          trial_end, metadata)
       VALUES ($1, $2, $3, $4, $5::billing.subscription_status,
               $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET
         stripe_customer_id     = EXCLUDED.stripe_customer_id,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         tier                   = EXCLUDED.tier,
         status                 = EXCLUDED.status,
         current_period_start   = EXCLUDED.current_period_start,
         current_period_end     = EXCLUDED.current_period_end,
         cancel_at_period_end   = EXCLUDED.cancel_at_period_end,
         trial_end              = EXCLUDED.trial_end,
         metadata               = EXCLUDED.metadata,
         updated_at             = now()
       RETURNING ${SUBSCRIPTION_COLUMNS}`,
      [
        orgId,
        sub.customer ?? null,
        sub.id ?? null,
        tier,
        status,
        isoOrNull(sub.current_period_start),
        isoOrNull(sub.current_period_end),
        Boolean(sub.cancel_at_period_end),
        isoOrNull(sub.trial_end),
        JSON.stringify(sub.metadata ?? {}),
      ],
    );
    return rows[0] ?? null;
  });
}
