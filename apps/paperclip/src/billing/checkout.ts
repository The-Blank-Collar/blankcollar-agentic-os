/**
 * Stripe Checkout + Billing-Portal session creation (Phase 8.2).
 *
 * No `stripe` SDK dep — same approach as `stripe.ts` (HMAC verification).
 * We hit the REST API directly with `application/x-www-form-urlencoded`,
 * which is what Stripe expects for `Sessions.create()`.
 *
 *   createCheckoutSession({ org, email, price_id, success_url, cancel_url })
 *     → returns { url, session_id }
 *   createBillingPortalSession({ customer_id, return_url })
 *     → returns { url }
 *
 * STRIPE_SECRET_KEY must be set; otherwise both throw a clear error so
 * the route can 503 with an "operator: set STRIPE_SECRET_KEY" hint.
 */

const STRIPE_API = "https://api.stripe.com/v1";

export class StripeApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "StripeApiError";
    this.status = status;
    this.body = body;
  }
}

function secret(): string {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new StripeApiError(0, null, "STRIPE_SECRET_KEY not set");
  return k;
}

/** Flatten nested values into Stripe's bracketed form-encoding. */
function encodeForm(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          out.push(...encodeForm(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === "object") {
      out.push(...encodeForm(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

async function postForm<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(body).join("&"),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* keep raw */ }
  if (!res.ok) {
    const errMsg = (json as { error?: { message?: string } } | null)?.error?.message
      ?? `HTTP ${res.status}`;
    throw new StripeApiError(res.status, json ?? text, `stripe: ${errMsg}`);
  }
  return json as T;
}

export type CheckoutInput = {
  org_id: string;
  email: string;
  price_id: string;
  /** "subscription" for recurring, "payment" for one-time. Default subscription. */
  mode?: "subscription" | "payment";
  success_url: string;
  cancel_url: string;
  /** Optional Stripe customer id to attach if known. */
  customer_id?: string | null;
  /** Allow the customer to update quantity at checkout. Default false. */
  allow_quantity?: boolean;
};

export type CheckoutSession = {
  id: string;
  url: string;
};

export async function createCheckoutSession(input: CheckoutInput): Promise<CheckoutSession> {
  const body: Record<string, unknown> = {
    mode: input.mode ?? "subscription",
    success_url: input.success_url,
    cancel_url: input.cancel_url,
    "line_items[0][price]": input.price_id,
    "line_items[0][quantity]": 1,
    "metadata[org_id]": input.org_id,
    "subscription_data[metadata][org_id]": input.org_id,
    allow_promotion_codes: "true",
  };
  if (input.customer_id) {
    body.customer = input.customer_id;
  } else {
    body.customer_email = input.email;
    body.customer_creation = "always";
  }
  if (input.allow_quantity) {
    body["line_items[0][adjustable_quantity][enabled]"] = "true";
    body["line_items[0][adjustable_quantity][minimum]"] = 1;
    body["line_items[0][adjustable_quantity][maximum]"] = 200;
  }
  const session = await postForm<{ id: string; url: string }>("/checkout/sessions", body);
  return { id: session.id, url: session.url };
}

export type PortalSession = { url: string };

export async function createBillingPortalSession(input: {
  customer_id: string;
  return_url: string;
}): Promise<PortalSession> {
  const session = await postForm<{ url: string }>("/billing_portal/sessions", {
    customer: input.customer_id,
    return_url: input.return_url,
  });
  return { url: session.url };
}
