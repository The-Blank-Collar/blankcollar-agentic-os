/**
 * External webhook receivers.
 *
 * /api/webhooks/stripe   — Stripe events, HMAC-verified, idempotent.
 * /api/webhooks/capture  — generic capture intake, HMAC-verified.
 *                          External services (forms, schedulers, vendor
 *                          alerts) drop here and the entry lands in the
 *                          capture pipeline as source=webhook.
 *
 * IMPORTANT: signature verification needs the EXACT raw bytes of the body.
 * We register a JSON content-type parser scoped to /api/webhooks/* that
 * preserves the raw string and parses to JSON in parallel.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { chatComplete, GatewayError } from "../llm/gateway.js";
import { resolveCallerScope } from "../scope.js";
import {
  StripeSignatureError,
  ensureStripeSchema,
  recordStripeEvent,
  verifyStripeSignature,
} from "../stripe.js";
import { sendMessage as tgSendMessage, TelegramApiError, TelegramConfigError } from "../telegram/client.js";

const STRIPE_SECRET = () => process.env.STRIPE_WEBHOOK_SECRET ?? "";
const CAPTURE_WEBHOOK_SECRET = () => process.env.INBOUND_CAPTURE_WEBHOOK_SECRET ?? "";
const TELEGRAM_WEBHOOK_SECRET = () => process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

function verifyHmac(rawBody: string, headerValue: string, secret: string): boolean {
  // Header format: "hmac-sha256=<hex>" (matches the Linear / GitHub style).
  const match = headerValue.match(/^hmac-sha256=([a-f0-9]+)$/i);
  const expectedHex = match ? match[1]! : headerValue.trim();
  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  if (expectedHex.length !== computed.length) return false;
  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(computed, "hex"));
}

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

  // ----- Capture webhook -------------------------------------------------
  // Body shape:
  //   {
  //     "raw_content": "string",          // required
  //     "title?":      "string",
  //     "metadata?":   { ... }            // free-form provenance
  //   }
  // Header:
  //   X-BC-Signature: hmac-sha256=<hex>
  app.post("/api/webhooks/capture", async (req, reply) => {
    const secret = CAPTURE_WEBHOOK_SECRET();
    if (!secret) {
      return reply
        .code(503)
        .send({ error: "capture_webhook_disabled", hint: "set INBOUND_CAPTURE_WEBHOOK_SECRET" });
    }
    const sigHeader = req.headers["x-bc-signature"];
    if (typeof sigHeader !== "string") {
      return reply.code(400).send({ error: "missing_signature" });
    }
    const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody ?? "";
    if (!rawBody) return reply.code(400).send({ error: "missing_body" });
    if (!verifyHmac(rawBody, sigHeader, secret)) {
      app.log.warn("capture webhook signature failed");
      return reply.code(400).send({ error: "invalid_signature" });
    }

    const body = req.body as { raw_content?: string; title?: string; metadata?: Record<string, unknown> } | undefined;
    if (!body?.raw_content || typeof body.raw_content !== "string" || body.raw_content.length === 0) {
      return reply.code(400).send({ error: "missing_raw_content" });
    }

    // Webhook captures still flow through the same classifier path. The
    // simplest implementation: insert a capture row directly with
    // source=webhook + a synthesised goal. Re-uses the classifier from
    // routes/captures.ts via a lightweight re-import.
    const { classify } = await import("./captures.js");
    const intent = classify(body.raw_content);
    const scope = await resolveCallerScope(req);

    const result = await withOrgScope(scope.org_id, async (client) => {
      const goalMetadata = {
        source: "webhook",
        capture_source: "webhook",
        ...(body.metadata ?? {}),
      };
      const { rows: goalRows } = await client.query<{ id: string }>(
        `INSERT INTO ops.goal (
           org_id, title, description, kind, cron_expr, due_at, target_value, metadata
         )
         VALUES ($1, $2, $3, $4::ops.goal_kind, $5, $6, $7, $8::jsonb)
         RETURNING id`,
        [
          scope.org_id,
          body.title?.slice(0, 200) ?? intent.title,
          intent.description ?? null,
          intent.kind,
          intent.cron_expr ?? null,
          intent.due_at ?? null,
          intent.target_value ?? null,
          JSON.stringify(goalMetadata),
        ],
      );
      const goalId = goalRows[0]!.id;

      const { rows: capRows } = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO ops.capture (
           org_id, source, raw_content, parsed_intent, resolved_to_id, resolved_kind
         )
         VALUES ($1, 'webhook'::ops.capture_source, $2, $3::jsonb, $4, $5)
         RETURNING id, created_at`,
        [
          scope.org_id,
          body.raw_content,
          JSON.stringify({ ...intent, ...(body.metadata ? { metadata: body.metadata } : {}) }),
          goalId,
          "goal",
        ],
      );
      const cap = capRows[0]!;
      await audit(
        {
          scope,
          action: "capture.create",
          target_type: "capture",
          target_id: cap.id,
          metadata: { goal_id: goalId, kind: intent.kind, source: "webhook" },
        },
        client,
      );
      return { capture_id: cap.id, goal_id: goalId, intent };
    });

    return reply.code(201).send(result);
  });

  // ----- Telegram webhook ------------------------------------------------
  // Bot → Telegram → here. Telegram sends a POST with the message envelope
  // and the secret token in the X-Telegram-Bot-Api-Secret-Token header.
  //
  // v1 round-trip:
  //   1. Verify the secret header.
  //   2. Extract the message text + chat id.
  //   3. Persist as a capture (existing pipeline → ephemeral goal).
  //   4. Call Portkey-routed chatComplete with a tight system prompt.
  //   5. Reply via the Telegram Bot API.
  //
  // Always return 200 OK to Telegram (even on internal errors — Telegram
  // retries 4xx/5xx aggressively, and the operator should see the failure
  // in our audit log + bot reply, not in a Telegram retry loop).
  //
  // Future v2: route through the real agent pipeline (plan + dispatch a
  // Hermes run + cascade the run output back to Telegram). v1 keeps the
  // path tight so the demo is fast.
  app.post("/api/webhooks/telegram", async (req, reply) => {
    const secret = TELEGRAM_WEBHOOK_SECRET();
    if (!secret) {
      return reply.code(503).send({
        error: "telegram_webhook_disabled",
        hint: "set TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET, then run ./infra/scripts/setup-telegram.sh",
      });
    }
    const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
    if (typeof headerSecret !== "string" || headerSecret !== secret) {
      app.log.warn("telegram webhook secret mismatch");
      return reply.code(401).send({ error: "invalid_secret" });
    }

    const update = req.body as
      | {
          update_id?: number;
          message?: {
            message_id?: number;
            text?: string;
            chat?: { id?: number; type?: string };
            from?: { id?: number; username?: string; first_name?: string };
          };
        }
      | undefined;
    const message = update?.message;
    if (!message?.text || !message.chat?.id) {
      // Non-text or non-message update (sticker, edit, callback) — ack + ignore.
      return reply.send({ ok: true, ignored: "non-text" });
    }
    const chatId = message.chat.id;
    const text = message.text;
    const messageId = message.message_id;

    const scope = await resolveCallerScope(req);

    // Persist the capture so the message lives in our audit + capture log
    // even if the LLM call fails. Operator sees it in /Activity either way.
    const captureRecord = await withOrgScope(scope.org_id, async (client) => {
      const { rows: goalRows } = await client.query<{ id: string }>(
        `INSERT INTO ops.goal (org_id, title, description, kind, metadata)
         VALUES ($1, $2, $3, 'ephemeral'::ops.goal_kind, $4::jsonb)
         RETURNING id`,
        [
          scope.org_id,
          text.slice(0, 200),
          text.length > 200 ? text : null,
          JSON.stringify({
            source: "telegram",
            telegram: {
              chat_id: chatId,
              message_id: messageId,
              from: message.from ?? null,
            },
          }),
        ],
      );
      const goalId = goalRows[0]!.id;
      const { rows: capRows } = await client.query<{ id: string }>(
        `INSERT INTO ops.capture
           (org_id, source, raw_content, parsed_intent, resolved_to_id, resolved_kind)
         VALUES ($1, 'webhook'::ops.capture_source, $2, $3::jsonb, $4, 'goal')
         RETURNING id`,
        [
          scope.org_id,
          text,
          JSON.stringify({
            source: "telegram",
            chat_id: chatId,
            message_id: messageId,
          }),
          goalId,
        ],
      );
      await audit(
        {
          scope,
          action: "telegram.message",
          target_type: "capture",
          target_id: capRows[0]!.id,
          metadata: {
            goal_id: goalId,
            chat_id: chatId,
            message_id: messageId,
            text_length: text.length,
          },
        },
        client,
      );
      return { goal_id: goalId, capture_id: capRows[0]!.id };
    });

    // Round-trip via the LLM. If Portkey is misconfigured or the call
    // fails, surface the error as a friendly Telegram reply instead of
    // 500-ing on Telegram (which would trigger their retry loop).
    let replyText: string;
    try {
      const llm = await chatComplete({
        system:
          "You are the assistant for The Blank Collar — a small AI-native studio. " +
          "Reply to the operator concisely (<= 3 short sentences). " +
          "If the message is a goal or task, acknowledge it briefly + say it's been logged. " +
          "Otherwise, answer plainly.",
        messages: [{ role: "user", content: text.slice(0, 4_000) }],
        max_tokens: 400,
      });
      replyText = llm.text.trim() || "(no reply generated)";
    } catch (err) {
      const detail =
        err instanceof GatewayError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      replyText = `⚠️ Brain unavailable right now: ${detail.slice(0, 300)}`;
      app.log.warn(`telegram → llm failed: ${detail}`);
    }

    try {
      await tgSendMessage(chatId, replyText, { reply_to_message_id: messageId });
    } catch (err) {
      // If Telegram itself rejects us (token revoked, bad chat id, …) we
      // still 200 the webhook — audit trail + paperclip log capture it.
      const detail =
        err instanceof TelegramApiError
          ? `${err.status} ${err.description ?? err.message}`
          : err instanceof TelegramConfigError
            ? "TELEGRAM_BOT_TOKEN missing"
            : (err as Error).message;
      app.log.error(`telegram sendMessage failed: ${detail}`);
    }

    return reply.send({ ok: true, ...captureRecord });
  });
}
