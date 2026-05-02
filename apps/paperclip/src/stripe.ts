/**
 * Stripe webhook signature verification + idempotent event recording.
 *
 * No `stripe` SDK dependency — we only need HMAC verification, not the
 * full Stripe API client. Verification follows Stripe's documented format:
 *
 *   Stripe-Signature: t=<unix>,v1=<hex>[,v0=<hex>...]
 *   signed_payload   = t + "." + raw_body
 *   expected         = HMAC_SHA256(signed_payload, webhook_secret)
 *   compared         = constant-time compare(expected, v1)
 *
 * A 5-minute timestamp tolerance is enforced.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { audit } from "./audit.js";
import { query, withOrgScope } from "./db.js";
import { resolveCallerScope } from "./scope.js";

const TOLERANCE_S = 5 * 60;

export class StripeSignatureError extends Error {}

export type StripeSigParts = { timestamp: number; v1Sigs: string[] };

export function parseStripeSignature(header: string): StripeSigParts {
  const parts = header.split(",").map((s) => s.trim());
  let timestamp = 0;
  const v1Sigs: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (k === "t") timestamp = Number(v);
    if (k === "v1") v1Sigs.push(v);
  }
  if (!timestamp || v1Sigs.length === 0) {
    throw new StripeSignatureError("malformed Stripe-Signature header");
  }
  return { timestamp, v1Sigs };
}

export function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
): true {
  const { timestamp, v1Sigs } = parseStripeSignature(header);

  const nowS = Math.floor(Date.now() / 1000);
  if (Math.abs(nowS - timestamp) > TOLERANCE_S) {
    throw new StripeSignatureError("timestamp outside tolerance");
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");

  for (const sig of v1Sigs) {
    if (sig.length !== expected.length) continue;
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) continue;
    if (timingSafeEqual(a, b)) return true;
  }
  throw new StripeSignatureError("no v1 signature matched");
}

// ---- Idempotent event recording ------------------------------------------

export async function ensureStripeSchema(): Promise<void> {
  await query(`CREATE SCHEMA IF NOT EXISTS billing`);
  await query(`
    CREATE TABLE IF NOT EXISTS billing.stripe_event (
      id              text PRIMARY KEY,
      type            text NOT NULL,
      received_at     timestamptz NOT NULL DEFAULT now(),
      payload         jsonb NOT NULL,
      processing_state text NOT NULL DEFAULT 'received'
    )
  `);
}

/**
 * Returns true if this is the first time we've seen this event.id,
 * false if it's a duplicate (replay).
 */
export async function recordStripeEvent(event: {
  id: string;
  type: string;
  payload: unknown;
}): Promise<boolean> {
  // Resolve the scope before opening the tx so withOrgScope can bind
  // app.org_id for the duration — otherwise the audit() insert into
  // core.audit_log would refuse under the Phase-2.6 strict RLS flip.
  const scope = await resolveCallerScope();
  return await withOrgScope(scope.org_id, async (client) => {
    const { rowCount } = await client.query(
      `
      INSERT INTO billing.stripe_event (id, type, payload)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (id) DO NOTHING
      `,
      [event.id, event.type, JSON.stringify(event.payload)],
    );
    if ((rowCount ?? 0) > 0) {
      await audit(
        {
          scope,
          action: `stripe.${event.type}`,
          target_type: "stripe_event",
          target_id: event.id,
          metadata: { type: event.type },
        },
        client,
      );
      return true;
    }
    return false;
  });
}
