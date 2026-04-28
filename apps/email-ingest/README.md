# Email Ingest (`agent@blankcollar.ai`)

Inbound email pipeline. Phase 7 deliverable.

## Status

Empty placeholder.

## What lands here

- `POST /webhooks/email` with HMAC signature verification
- Parser that maps an inbound email to:
  - A `brain.memory` of kind `conversation` (always)
  - A `goal` row in `draft` (if the parser detects an actionable request)
- Reply pipeline using the `email.send` skill
- Bounce / spam / loop guards (don't reply to your own auto-replies)

## Env vars (from `.env.example`)

- `INBOUND_EMAIL_WEBHOOK_SECRET` — HMAC for the inbound webhook
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` — outbound

## Provider

TBD. Candidates: Postmark (best inbound parsing), Resend (clean DX), AWS SES (cheap at scale). The provider is swappable — we own the canonical event format inside the app.

## Threading

Each email thread maps 1:1 to a `goal_id` once the goal is created. Subsequent replies on that thread are appended as `conversation` memories scoped to that goal.

## Non-goals

- Not a full IMAP client. We receive via webhook, send via SMTP.
- No client-side email composition UI. Replies are drafted by agents.
