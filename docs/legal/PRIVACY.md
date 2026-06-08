# Privacy Policy

> **Skeleton — replace with a Termly / Iubenda / hand-reviewed version before launch.**
> This file is a starting point that names every data system Blank Collar actually
> touches in code, so a real lawyer can finalise without re-discovering them.

**Last updated:** [DATE]

## 1. Who we are

The Blank Collar ("we", "us", "our") operates the Blank Collar Agentic OS at
[app.blankcollar.ai] and the marketing site at [www.blankcollar.ai].
The legal entity is [LEGAL ENTITY NAME], registered in [JURISDICTION] at
[REGISTERED ADDRESS]. Contact us at [hello@blankcollar.ai].

## 2. What data we collect

When you use Blank Collar Agentic OS, we collect:

**Account data** (required to give you an account):
- Email address — via Supabase Auth.
- Name (optional) — from your sign-up form or OAuth provider.
- Hashed password — managed by Supabase Auth; we never see plaintext.
- Organisation membership and role assignments.

**Operational data** (what your studio is doing):
- Goals you capture and edit (`ops.goal`).
- Run inputs + outputs, including LLM completions (`ops.run`).
- Captures (raw natural-language requests you type or send via Telegram).
- Briefings, summaries, and structured outcomes (`ops.outcome`).
- Memory entries — including narrative wrap-ups after every agent run
  (`brain.memory`) and per-goal context documents (`ops.goal_context`).
- Audit log of every mutation (`core.audit_log`).
- Web pages you ingest via the URL ingest feature.

**Billing data** (if you subscribe):
- Stripe customer ID, subscription status, tier, and period boundaries
  (`billing.subscription`).
- We never receive or store your full card number. Stripe handles all
  payment data directly.

**Integration data** (when you connect channels):
- Telegram chat IDs and message text routed through the bot.
- OAuth tokens for connected providers (Slack, Google, Notion, …) —
  stored encrypted via Nango, never plaintext in our database.

**Inferred data** (created by the system based on the above):
- Hot-context knowledge documents derived from your onboarding answers.
- Voice and governance profiles.
- Few-shot examples drawn from past outcomes.

We do **not** sell any of this data. We do not run ads.

## 3. How we use it

- To operate the service: dispatch your agents, generate briefings,
  match past outcomes, persist memory across runs.
- To bill you (Stripe webhooks → `billing.subscription`).
- To send transactional email — welcome, invitations, billing receipts.
  Marketing email is opt-in only.
- To improve the product: aggregate, anonymised metrics only. We do
  not train models on your private content without explicit opt-in.

## 4. Third-party sub-processors

These vendors process data on our behalf:

| Vendor | Purpose | Data |
|---|---|---|
| **Supabase** | Authentication + Postgres | Email, hashed password, session JWTs |
| **Stripe** | Payments | Card data (Stripe-side), subscription state |
| **Portkey** | LLM gateway | Prompts + completions you generate; logs latency, cost, traces |
| **Anthropic / OpenAI / Hermes provider** | LLM execution | Prompts + completions you generate (routed via Portkey) |
| **Nango** | OAuth + connector framework | OAuth tokens for integrations |
| **Resend** (or Postmark) | Transactional email | Email content + recipient address |
| **Hostinger / Hetzner / [your VPS]** | Compute + storage | Everything else, in our database, on their server |
| **Cloudflare / Vercel** | CDN + edge | Page assets, IP + request metadata |

## 5. Data retention

- **Active subscription**: we retain everything for the lifetime of your
  account.
- **Cancelled subscription, free tier**: data retained for 90 days, then
  deletable on request.
- **Audit log**: retained for 1 year after cancellation for security +
  legal compliance, then permanently deleted.
- **Memory and outcome data**: deleted with the parent goal/run; we
  surface a "delete my account" path that wipes everything in <30 days.

## 6. Your rights

You can, at any time:
- **Access** your data — every UI surface in the app shows you the rows
  we hold (Settings → Memory, Settings → Overview, every goal page).
- **Export** your data — request a JSON dump via [hello@blankcollar.ai].
  We'll deliver within 30 days.
- **Correct** your data — edit any user-editable field in the UI.
- **Delete** your account — Settings → Account → Delete account.
  Asynchronous deletion completes within 30 days.
- **Object** to processing or **withdraw consent** for any specific
  vendor — email [hello@blankcollar.ai].

EU/UK users: you have rights under GDPR. Your supervisory authority is
your national DPA.

California users: you have rights under CCPA. We do not sell your
personal information.

## 7. Cookies + local storage

We use:
- A **Supabase session cookie** (HttpOnly, same-origin) to keep you
  signed in.
- **localStorage / sessionStorage** for transient UI state (theme
  preference, onboarding-wizard dismissal). Cleared on sign-out.

We do **not** use third-party tracking cookies. We do not use Google
Analytics or Facebook Pixel.

## 8. Security

- All traffic is HTTPS only.
- Database connections require TLS.
- Supabase Auth handles password hashing with industry-standard
  algorithms (Argon2 / bcrypt). We never see plaintext passwords.
- Row-Level Security (Postgres RLS) is enforced on every tenant table;
  unscoped queries return zero rows.
- LLM provider keys, Stripe keys, JWT secrets are stored in
  environment variables, never in the repository.
- We use Sentry (when configured) for production error monitoring;
  sensitive payloads are scrubbed before sending.

## 9. Children

Blank Collar is not directed at users under 16. We do not knowingly
collect data from children under 16. If you believe we have, contact us
immediately and we will delete it.

## 10. Changes to this policy

We will email all users at least 30 days before any material change
takes effect, except where required by law to act sooner.

## 11. Contact

Questions about this policy: [hello@blankcollar.ai].
Data protection officer: [DPO NAME / hello@blankcollar.ai].
Mailing address: [REGISTERED ADDRESS].
