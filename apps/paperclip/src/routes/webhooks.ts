/**
 * External webhook receivers — currently just Stripe.
 *
 * IMPORTANT: signature verification needs the EXACT raw bytes of the body.
 * We register a JSON content-type parser scoped to /api/webhooks/* that
 * preserves the raw string and parses to JSON in parallel.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  StripeSignatureError,
  ensureStripeSchema,
  recordStripeEvent,
  verifyStripeSignature,
} from "../stripe.js";

const STRIPE_SECRET = () => process.env.STRIPE_WEBHOOK_SECRET ?? "";

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Capture the raw body for any /api/webhooks/* request, in addition to
  // the parsed JSON we still want for handlers.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    function jsonAndRaw(this: FastifyInstance, req, body: string, done) {
      // Only stash raw on webhook routes — other routes get normal JSON parse.
      if (req.url.startsWith("/api/webhooks/")) {
        (req as FastifyRequest & { rawBody?: string }).rawBody = body;
      }
      try {
        const json = body.length === 0 ? {} : JSON.parse(body);
        done(null, json);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        (e as Error & { statusCode?: number }).statusCode = 400;
        done(e, undefined);
      }
    },
  );

  // Make sure the billing schema exists. Idempotent.
  try {
    await ensureStripeSchema();
  } catch (err) {
    app.log.error({ err }, "ensureStripeSchema failed");
  }

  app.post("/api/webhooks/stripe", async (req, reply) => {
    const secret = STRIPE_SECRET();
    if (!secret) {
      return reply
        .code(503)
        .send({ error: "stripe_disabled", hint: "set STRIPE_WEBHOOK_SECRET" });
    }
    const sigHeader = req.headers["stripe-signature"];
    if (typeof sigHeader !== "string") {
      return reply.code(400).send({ error: "missing_signature" });
    }
    const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody ?? "";
    if (!rawBody) {
      return reply.code(400).send({ error: "missing_body" });
    }

    try {
      verifyStripeSignature(rawBody, sigHeader, secret);
    } catch (err) {
      const msg = err instanceof StripeSignatureError ? err.message : "invalid_signature";
      app.log.warn({ msg }, "stripe webhook signature failed");
      return reply.code(400).send({ error: "invalid_signature" });
    }

    // Body is parsed JSON because of the content-type parser above.
    const event = req.body as { id?: string; type?: string };
    if (!event?.id || !event?.type) {
      return reply.code(400).send({ error: "malformed_event" });
    }

    const isNew = await recordStripeEvent({
      id: event.id,
      type: event.type,
      payload: event,
    });

    return reply.send({ received: true, id: event.id, type: event.type, duplicate: !isNew });
  });
}
