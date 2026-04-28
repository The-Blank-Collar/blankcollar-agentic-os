# Stripe

Deep-dive on the Stripe integration. The short version lives in
[`INTEGRATIONS.md`](INTEGRATIONS.md#stripe-billing); env vars are in
[`ENVIRONMENT.md`](ENVIRONMENT.md#stripe-phase-7--billing); end-to-end
production setup is in
[`HOSTINGER_DEPLOY.md`](HOSTINGER_DEPLOY.md#8-configure-stripe--supabase-optional-when-ready).
This page is the source of truth for **how Stripe is wired into the stack**.

Upstream reference: <https://docs.stripe.com>.

## Why Stripe

Subscription billing for the hosted product. Self-hosters never need to touch
it. Stripe is the **source of truth for entitlement** — never grant features
based on the local DB alone (see [Security rules](#security-rules)).

## Status today

Phase 0 lands the receiver scaffolding only:

| Capability                                  | Status   | Where                                             |
|---------------------------------------------|----------|---------------------------------------------------|
| Webhook receiver + HMAC verification        | shipped  | `apps/paperclip/src/stripe.ts`                    |
| Idempotent event log (`billing.stripe_event`) | shipped | `apps/paperclip/src/stripe.ts`                    |
| `POST /api/webhooks/stripe` route           | shipped  | `apps/paperclip/src/routes/webhooks.ts`           |
| Audit-log entry per first-seen event        | shipped  | `core.audit_log` (`stripe.<type>` actions)        |
| Customer / subscription mirror              | Phase 7  | `apps/billing/`                                   |
| Entitlement endpoint                        | Phase 7  | `GET /api/billing/entitlement`                    |
| Customer Portal session minting             | Phase 7  | `apps/billing/`                                   |
| `payments.charge` skill                     | Phase 5  | `packages/skills/payments/charge.yaml` (planned)  |

When `STRIPE_WEBHOOK_SECRET` is unset, the route returns `503 stripe_disabled`
so the rest of the stack runs healthy without billing configured.

## Environment variables

| Variable                  | Purpose                                          | Where it lives           |
|---------------------------|--------------------------------------------------|--------------------------|
| `STRIPE_SECRET_KEY`       | Server-side API calls (`sk_live_…` / `sk_test_…`). | Paperclip server only.   |
| `STRIPE_PUBLISHABLE_KEY`  | Browser-side checkout (`pk_live_…` / `pk_test_…`). | Safe to ship to client.  |
| `STRIPE_WEBHOOK_SECRET`   | HMAC verification (`whsec_…`). Always required for webhooks. | Paperclip server only. |

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` **never** leave the server.
They are not exposed via Paperclip's public config endpoint, never bundled
into the website, and are gitignored via `.env`.

## Webhook flow

```
Stripe ──► POST /api/webhooks/stripe ──► verifyStripeSignature()
                                            │
                                            ├─► reject 400 invalid_signature
                                            │
                                            └─► recordStripeEvent()
                                                    │
                                                    ├─► first time   → audit + 200 { duplicate: false }
                                                    └─► duplicate id → 200 { duplicate: true }
```

### Signature verification

Implemented without the `stripe` SDK — only HMAC-SHA256 plus a constant-time
compare. Stripe's signed-payload format:

```
Stripe-Signature: t=<unix>,v1=<hex>[,v0=<hex>...]
signed_payload   = t + "." + raw_body
expected         = HMAC_SHA256(signed_payload, webhook_secret)
```

A **5-minute timestamp tolerance** is enforced to limit replay windows.

The raw request body is captured by a content-type parser scoped to
`/api/webhooks/*` so Fastify can still parse JSON for the handler while
verification has the exact bytes Stripe signed. Any other route gets a normal
JSON parse — do not move webhook routes outside `/api/webhooks/*` without
re-thinking that parser.

### Idempotency

Every event is written into `billing.stripe_event` keyed by Stripe's `event.id`
with `ON CONFLICT (id) DO NOTHING`. Replays return `200 { duplicate: true }`
without re-firing audit-log entries or downstream side effects.

Schema:

```sql
CREATE TABLE billing.stripe_event (
  id               text PRIMARY KEY,        -- Stripe event id, e.g. evt_1Nz...
  type             text NOT NULL,           -- e.g. customer.subscription.deleted
  received_at      timestamptz NOT NULL DEFAULT now(),
  payload          jsonb NOT NULL,          -- the full event envelope
  processing_state text NOT NULL DEFAULT 'received'
);
```

The schema and table are created on Paperclip startup (`ensureStripeSchema()`).

### Audit

The first time an event is recorded, `core.audit_log` gets a row with:

```
action      = "stripe.<event.type>"        e.g. "stripe.invoice.paid"
target_type = "stripe_event"
target_id   = "<event.id>"
metadata    = { type: "<event.type>" }
```

Replays do not produce additional audit rows.

## Local development

### Forwarding events with the Stripe CLI

```bash
# one-time
brew install stripe/stripe-cli/stripe
stripe login

# forward live test events into Paperclip
stripe listen --forward-to http://localhost:8080/api/webhooks/stripe
```

`stripe listen` prints a `whsec_…` value — copy it into `.env` as
`STRIPE_WEBHOOK_SECRET` and restart Paperclip.

Trigger a sample event in another shell:

```bash
stripe trigger customer.created
stripe trigger invoice.paid
```

Confirm receipt:

```bash
make psql -- -c "SELECT id, type, received_at FROM billing.stripe_event ORDER BY received_at DESC LIMIT 5;"
make psql -- -c "SELECT action, target_id FROM core.audit_log WHERE action LIKE 'stripe.%' ORDER BY created_at DESC LIMIT 5;"
```

### Tests

`apps/paperclip/test/stripe.test.ts` covers the parser and verifier:

- valid header round-trip
- tampered body
- wrong secret
- replay outside tolerance
- malformed `Stripe-Signature`

`recordStripeEvent` needs a Postgres connection; it lives in the integration
layer (added with the broader integration suite in Phase 1+).

## Production setup

End-to-end walkthrough is in
[`HOSTINGER_DEPLOY.md`](HOSTINGER_DEPLOY.md#stripe-webhook). Short version:

1. Stripe Dashboard → *Developers → Webhooks → Add endpoint*.
2. URL: `https://<your-domain>/api/webhooks/stripe`.
3. Select the events you actually consume (start narrow — see
   [Event subscription](#event-subscription) below).
4. Copy the **Signing secret** into `.env` as `STRIPE_WEBHOOK_SECRET`.
5. Paste your secret key into `STRIPE_SECRET_KEY` (use a restricted key —
   <https://docs.stripe.com/keys#create-restricted-secret-key>).
6. Restart Paperclip; verify with a test event from the dashboard.
7. Confirm a row in `billing.stripe_event` and a row in `core.audit_log`.

## Event subscription

Phase 7 will consume, at minimum:

| Event                                  | Reactor effect                                                 |
|----------------------------------------|----------------------------------------------------------------|
| `checkout.session.completed`           | Promote draft org to paid; create initial entitlement.         |
| `customer.subscription.created`        | Mirror subscription into `billing.subscription`.               |
| `customer.subscription.updated`        | Re-resolve entitlement; emit `core.role_assignment` deltas.    |
| `customer.subscription.deleted`        | Drop entitlement to free tier; revoke paid-only roles.         |
| `invoice.paid`                         | Mark period paid; clear any "past_due" lockouts.               |
| `invoice.payment_failed`               | Flag org as past_due; surface in dashboard.                    |
| `customer.deleted`                     | Soft-delete the customer mirror; keep audit trail.             |

Subscribe **narrowly**. Every extra event type is more replay surface and
more code to keep idempotent.

Stripe event reference: <https://docs.stripe.com/api/events/types>.

## Security rules

These are non-negotiable. Most are enforced in code; a few are review-time
rules.

1. **Always verify `Stripe-Signature`.** Never accept a webhook without it,
   even in dev. The receiver returns `503` rather than no-op when the secret
   is unset, so missing config fails loudly.
2. **Constant-time compare.** Use `timingSafeEqual` (already wired) — never
   `===` on signature bytes.
3. **Stripe is the source of truth for entitlement.** Local DB rows mirror
   Stripe; they do not authorise. The entitlement endpoint reads the mirror
   but reconciles against Stripe on a schedule.
4. **Idempotency is mandatory** for any reactor that writes downstream state
   (subscription mirror, role assignments, etc.). Use `event.id` as the
   idempotency key — never the timestamp, never a tuple of fields.
5. **Restricted keys for server-side calls.** Don't ship `sk_live_…` with
   full scope. Use a restricted key with only the resources Paperclip
   actually needs.
6. **`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only.** They
   are never returned by any API endpoint, never embedded in HTML, never
   logged. Treat a leak as a key-rotation incident.
7. **PII handling.** Stripe payloads include emails and (in some events)
   partial card metadata. The full event envelope is stored in
   `billing.stripe_event.payload`. Treat that table as PII; retention &
   redaction are tracked in `BACKUP_RESTORE.md`.
8. **Replay window.** The 5-minute timestamp tolerance is deliberate — do
   not widen it without thinking through the replay implications.

## Skill: `payments.charge`

The skill catalogue (`docs/SKILLS.md`) reserves `payments.charge` for
agent-initiated Stripe charges. It is **`requires_approval`** by default and
will be `idempotent: false` (the human operator is the idempotency gate).
Implementation lands with Phase 5 alongside the rest of the skill registry.

## Failure modes & runbook

| Symptom                                                | Likely cause                                                       | Fix                                                                                  |
|--------------------------------------------------------|--------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| `503 stripe_disabled` on `/api/webhooks/stripe`        | `STRIPE_WEBHOOK_SECRET` unset.                                     | Set it; restart Paperclip.                                                           |
| `400 invalid_signature` on every event                 | Wrong webhook secret, or reverse proxy is rewriting the body.      | Re-copy from Stripe Dashboard. Verify proxy passes `/api/webhooks/*` raw.            |
| `400 invalid_signature` for **old** retries only       | Timestamp outside the 5-minute tolerance. Expected for retries.    | None — Stripe will redeliver fresh signatures.                                       |
| Duplicate effects in downstream tables                 | A reactor isn't keying on `event.id`.                              | Add an `ON CONFLICT` guard keyed on `event.id` and a unit test that double-fires it. |
| Webhook works locally, fails in prod                   | `stripe listen` secret left in `.env`; prod needs the dashboard secret. | Replace with the production endpoint's signing secret.                            |
| `400 missing_body`                                     | Content-type parser bypassed (e.g. Stripe sent `application/x-www-form-urlencoded`). | Should not happen — Stripe always sends JSON. Check the proxy.                  |

## See also

- `apps/paperclip/src/stripe.ts` — verifier, parser, recorder.
- `apps/paperclip/src/routes/webhooks.ts` — route + raw-body parser.
- `apps/paperclip/test/stripe.test.ts` — parser + verifier tests.
- `apps/billing/README.md` — Phase 7 plan.
- [`docs/SCHEMA.md`](SCHEMA.md) — `billing.*` schema.
- [`docs/SECURITY.md`](../SECURITY.md) — security model summary.
- Stripe docs: <https://docs.stripe.com>.
- Webhook signing: <https://docs.stripe.com/webhooks/signatures>.
- Restricted API keys: <https://docs.stripe.com/keys#create-restricted-secret-key>.
- Event types: <https://docs.stripe.com/api/events/types>.
