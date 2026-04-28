# Integrations

External systems Blank Collar talks to (or will). Each section covers: what it's for, when it lands, the env vars, and the risks.

## Anthropic / OpenAI (LLM providers)

**For:** model calls inside agents and the embedding pipeline.

**When:** optional in Phase 0; first real use in Phase 1 (gbrain embeddings) and Phase 3 (agent reasoning).

**Env vars:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.

**Notes:**
- Provider choice is per-component, not global. gbrain may use OpenAI embeddings while Hermes uses Claude.
- Costs accumulate fast in agentic loops. Per-run `budget_per_run_cents` is enforced by the adapter (see `AGENTS.md`).
- Cache prompts where the SDK supports it. For Anthropic specifically, use prompt caching on the long-lived system prompt blocks.

## Qdrant (vector store)

**For:** semantic recall in the Company Brain.

**When:** Phase 0 — already in the compose stack.

**Env vars:** `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_HTTP_PORT`, `QDRANT_GRPC_PORT`.

**Notes:**
- Collections are created on first write per `(org, kind)`.
- The dashboard at `:6333/dashboard` is the easiest way to peek at vectors during dev.
- Don't expose the port outside `localhost` without setting `QDRANT_API_KEY`.

## Supabase (auth & roles)

**For:** hosted authentication, user management, role mapping.

**When:** Phase 6.

**Env vars:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

**Architecture:**

- Supabase issues JWTs for end users.
- Paperclip's edge middleware verifies the JWT, looks up the user in `core.user_account`, resolves their `core.role_assignment` rows into a `Scope`, and attaches it to the request.
- `SUPABASE_SERVICE_ROLE_KEY` is **server-only**. It must never be sent to the browser, never be embedded in client bundles.

**Risks:**
- Mis-mapped roles = privilege escalation. The mapping job that copies Supabase user metadata into `core.role_assignment` is high-trust code.
- Test the JWT verification on every request, not just on login.

## Stripe (billing)

**For:** subscription billing for the hosted product.

**When:** Phase 7.

**Env vars:** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.

**Architecture:**

- Customer + Subscription objects mirror to a `billing.*` schema (added in Phase 7).
- Webhook endpoint at `POST /webhooks/stripe`. Always verify `Stripe-Signature`.
- Treat Stripe as the source of truth for entitlement. Never grant features based on local DB alone.

**Risks:**
- Replay attacks if signature verification is skipped — never skip it.
- Race conditions on subscription state changes — handle webhooks idempotently.

## Inbound email (`agent@blankcollar.ai`)

**For:** turning emails into goals or memories. The customer-facing "send a request to your agent" flow.

**When:** Phase 7.

**Env vars:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `INBOUND_EMAIL_WEBHOOK_SECRET`.

**Architecture:**

- Inbound provider (Postmark / Resend / SES — TBD) posts to `POST /webhooks/email` with HMAC signature.
- The email becomes a `brain.memory` of kind `conversation`. If the parser detects an actionable request, a `goal` row is also created in `draft` status awaiting human approval.
- Outbound replies use the `email.send` skill (which is `requires_approval` by default).

**Risks:**
- Spoofed sender. Verify SPF/DKIM at the inbound provider, not in our app.
- PII in arbitrary email content — the Brain stores it; respect the visibility scope.

## MCP servers (intelligence layer)

**For:** plugging external tools into the skill catalogue.

**When:** Phase 5.

**Notes:**
- Each MCP server is registered with name, transport, auth.
- Tools become skills automatically (`<server>.<tool>` IDs).
- Auth credentials live in the secure store, not in `.env`.

## What we'll deliberately *not* integrate (early)

- Slack / Discord / Teams — convenient but pull users back to "messaging an agent" instead of the dashboard. Phase 8+.
- CRM-of-the-month deep integrations. Build the generic `db.query_*` and `email.*` skills first; people can wire their CRM through those.
- Calendars beyond a single primary. One source of truth at a time.
- Anything that requires a long-running OAuth dance during onboarding. Onboarding has to feel like 60 seconds; deep integrations come *after* the user has run their first goal.
