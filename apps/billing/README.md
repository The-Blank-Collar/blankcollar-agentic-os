# Billing — Stripe webhook + idempotent event log

Stripe billing for the hosted product. Like the auth scaffolding, the
**Phase 7 implementation lives inside Paperclip**:

- `apps/paperclip/src/stripe.ts` — `verifyStripeSignature()` + `recordStripeEvent()` + schema bootstrap
- `apps/paperclip/src/routes/webhooks.ts` — `POST /api/webhooks/stripe`

This folder is reserved for future billing-specific code (entitlement service,
portal session minting, plan-change reactors). Empty in v0 by design.

## What ships now

- Webhook endpoint at `POST /api/webhooks/stripe` accepts Stripe events,
  verifies the `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET`
  using HMAC-SHA256 with a 5-minute timestamp tolerance.
- Idempotent recording: every event is written once into `billing.stripe_event`
  (`ON CONFLICT DO NOTHING`). The endpoint reports `duplicate: true` for replays.
- Audit-log entry per first-seen event (`stripe.<type>`).
- Returns `503 stripe_disabled` when `STRIPE_WEBHOOK_SECRET` is unset, so
  the rest of the stack runs healthy without billing configured.

## Setup checklist

1. Create a Stripe account and a test-mode webhook endpoint pointing at
   `https://<your-domain>/api/webhooks/stripe`.
2. Copy the **Signing secret** (`whsec_…`) into `.env` as `STRIPE_WEBHOOK_SECRET`.
3. (For server-side API calls) copy your secret key into `STRIPE_SECRET_KEY`.
4. Restart Paperclip; the `billing` schema and `billing.stripe_event` table
   are created on startup if missing.
5. From Stripe's dashboard, send a test event — confirm it shows up in
   `billing.stripe_event` and a row appears in `core.audit_log`.

## Phase 7+ will add

- Customer / subscription tables mirrored from Stripe.
- Entitlement endpoint `/api/billing/entitlement` Paperclip uses to gate
  features per plan tier.
- Stripe Customer Portal session minting.
- Reactors that translate `customer.subscription.deleted` etc. into
  `core.role_assignment` changes.
