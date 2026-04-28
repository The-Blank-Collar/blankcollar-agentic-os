# Billing

Stripe-powered billing for the hosted product. Phase 7 deliverable.

## Status

Empty placeholder. The folder reserves the slot in the monorepo and signals to future contributors that billing is a first-class app, not a sprinkle of Stripe code in the orchestrator.

## What lands here

- Stripe customer/subscription bootstrap on org creation
- `POST /webhooks/stripe` with signature verification
- Entitlement service: per-org `(plan, agents_max, runs_per_day_max, monthly_budget_cents)`
- Usage metering — daily aggregation of run cost into a billable counter
- Customer portal links

## Env vars (from `.env.example`)

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

## Integration points

- Reads/writes `billing.*` schema (added in Phase 7).
- Calls Paperclip's `entitlement` API to gate feature access.
- Listens on the audit log for "run finished" events to roll up cost.

## Non-goals

- No billing UI. The Stripe-hosted customer portal is the UI. We don't build a card form.
- No invoicing edge cases beyond what Stripe handles natively.
- No third-party tax engines until we have a real reason.
