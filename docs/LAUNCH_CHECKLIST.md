# Launch Checklist

Single source of truth for "what's left between this codebase and a paying customer."
Everything in this list either needs a credential you control or a manual decision
only you can make.

> Code-side, the product is feature-complete for an MVP launch. Auth, billing,
> the agent loop, the memory layers, the goal-first UX, the brand — all in.
> Last verified: 437 tests pass across all 10 packages; static QA gates green
> on the refreshed stack (Postgres 18, TypeScript 6, Zod 4, React 19, Vite 8,
> vitest 4, jose 6, Node 24, structlog 26, neo4j 5.26 LTS).

## P0 — Required before you take a real payment

### ☐ Stripe — wire payments
1. Sign up at https://dashboard.stripe.com (keep Test mode toggled)
2. Create two products with metadata `tier = pro` and `tier = studio`,
   $49/mo and $199/mo (or whatever you choose). Copy the Price IDs.
3. Get the Test secret key (`sk_test_…`).
4. Install Stripe CLI: `brew install stripe/stripe-cli/stripe`
5. Run `stripe listen --forward-to http://localhost:3001/api/webhooks/stripe`
   and copy the printed `whsec_…`.
6. Run `make setup-stripe` and paste the four values.
7. Walk through `Settings → Billing → Upgrade to Pro` with test card
   `4242 4242 4242 4242`. Watch the `stripe listen` terminal show
   `checkout.session.completed` + `customer.subscription.created`.
8. Verify `SELECT tier, status FROM billing.subscription` shows
   the row.

### ☐ Production hosting
1. Decide on a path:
   - **Coolify on a VPS** ($10/mo) — recommended, see `docs/HOSTINGER_DEPLOY.md`
     and `docs/HETZNER_DEPLOY.md`.
   - **Render** / **Railway** — easier but ~$50-100/mo.
   - **Fly.io** — cheaper than Render, more config.
2. Provision the VPS / project.
3. Point DNS:
   - `app.blankcollar.ai` → website (apps/website), via Vercel or your VPS
   - `api.blankcollar.ai` → paperclip (apps/paperclip), via your VPS
4. Update env in production:
   - `SUPABASE_URL`, `SUPABASE_JWT_SECRET` (same project as local)
   - `STRIPE_SECRET_KEY` (live key after passing 7c below)
   - `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_STUDIO`
   - `STRIPE_WEBHOOK_SECRET` (from Stripe Dashboard webhook, not the CLI)
   - `WEBSITE_PUBLIC_URL=https://app.blankcollar.ai`
   - `VITE_PAPERCLIP_URL=https://api.blankcollar.ai`
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - `PAPERCLIP_AUTH_ENFORCE=true`
   - `BLANKCOLLAR_BILLING_ENFORCE=true`
   - `MAIL_PROVIDER=resend`, `MAIL_API_KEY=re_…`, `MAIL_FROM=…`
5. Configure CORS — paperclip allowlists `https://app.blankcollar.ai`.
6. In Supabase dashboard, add `https://app.blankcollar.ai` to the URL
   Configuration → Site URL + Redirect URLs.
7. **Stripe live mode**:
   a. Activate your Stripe account (KYC: business info, tax info, bank).
   b. Recreate the two products in Live mode.
   c. Update the live `sk_live_*` + `price_*` env vars.
   d. Configure the live webhook endpoint at
      `https://api.blankcollar.ai/api/webhooks/stripe`.

### ☐ Email delivery
1. Sign up at https://resend.com (free tier: 3,000 emails/mo).
2. Add `blankcollar.ai` as a domain; follow the DNS records (SPF, DKIM,
   return path) on your registrar.
3. Wait for verification (~10 min). Click "Verify".
4. Create an API key. Set:
   - `MAIL_PROVIDER=resend`
   - `MAIL_API_KEY=re_…`
   - `MAIL_FROM=Blank Collar <noreply@blankcollar.ai>`
5. Verify by sending an invite from Settings → People — the recipient
   should get a real email, not just a stdout log.

### ☐ Legal pages
1. Sign up at https://app.termly.io (free tier covers Privacy + ToS).
2. Generate a Privacy Policy + Terms of Service using their wizard.
   Use `docs/legal/PRIVACY.md` and `docs/legal/TERMS.md` as starting
   reference for what to mention (data systems, sub-processors, retention).
3. Host the generated pages at `www.blankcollar.ai/privacy` and
   `www.blankcollar.ai/terms`.
4. Add links to those pages in the website footer + sign-up screen.

### ☐ Marketing → app handoff
1. Update `www.blankcollar.ai` so the "Sign up" / "Get started" CTA
   points at `https://app.blankcollar.ai`.
2. Add a pricing section that mirrors what's in Settings → Billing.
3. Link Privacy + Terms in the footer.
4. (Optional) Add a "How it works" walkthrough using the screenshots
   from a fresh signup.

## P1 — Strongly recommended before going live

### ☐ Production observability (Sentry)
1. Sign up at https://sentry.io (free tier: 5K errors/mo).
2. Create projects for `paperclip` (Node) and `website` (React).
3. Get the DSNs. Set:
   - Backend: `SENTRY_DSN=…` on paperclip
   - Frontend: `VITE_SENTRY_DSN=…` on the website build
4. Wire `@sentry/react` and `@sentry/node` — small code change, ~30 min.
   (TODO: I'll ship this when you have the DSN.)

### ☐ Uptime monitoring
1. Add `https://api.blankcollar.ai/api/health` to UptimeRobot,
   BetterStack, or Cronitor. Free tier covers it.
2. Configure SMS / Slack alerts.

### ☐ Daily Postgres backups
- **Supabase Pro**: included.
- **Self-host PG**: cron `pg_dump` → S3 or Backblaze; see
  `docs/BACKUP_RESTORE.md`.

### ☐ Account-level operator tooling
- Account deletion path (Settings → Account → Delete account) — not yet
  built; ~2-hour sprint when ready.
- Data export (JSON dump on request) — Phase 9.x follow-up.

## P2 — Nice to ship, not blocking

- **Sprint 9.4 — Slack connector** (real OAuth via Nango). Most-asked
  channel. ~1-2 days.
- **Sprint 9.6 — Web knowledge graph polish** (Firecrawl-ish enhanced
  HTML→markdown extraction). ~half a day.
- **Onboarding improvements**: bigger sample goals, video walkthrough,
  email digest of first week.
- **In-app docs** at app.blankcollar.ai/docs.
- **CLI release** — package + publish `bc` for users who want to drive
  the API from a terminal.

## What's running where (target architecture)

```
                ┌─────────────────────┐
                │  www.blankcollar.ai │   (marketing)
                │  (your existing)    │
                └──────────┬──────────┘
                           │ "Sign up" CTA
                           ▼
       ┌──────────────────────────────────────┐
       │       app.blankcollar.ai             │
       │       (Vercel — apps/website)        │
       │   • React SPA, Vite build            │
       │   • Static, global CDN               │
       │   • Talks to api.* over HTTPS        │
       └────────────────────┬─────────────────┘
                            │
                            ▼
       ┌──────────────────────────────────────┐
       │       api.blankcollar.ai             │
       │       (your VPS — apps/paperclip)    │
       │   • Fastify orchestrator             │
       │   • Worker dispatches to agents      │
       │   • Stripe webhook receiver          │
       │   • Telegram webhook receiver        │
       └──┬───────┬───────┬───────┬───────┬──┘
          │       │       │       │       │
          ▼       ▼       ▼       ▼       ▼
       Hermes  OpenClaw LangGraph Graphiti gbrain
       (all in the same VPS Docker compose stack)
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
      Supabase PG       Qdrant       Neo4j   (on VPS or managed)
       (managed)
```

Everything in italics is a vendor decision — Supabase is locked in for
auth, Stripe is locked in for billing, Portkey is locked in for the
LLM gateway. Everything else is interchangeable.

## Final pre-launch smoke

Once P0 is done, end-to-end smoke this path **from a fresh incognito
on a clean browser, against production URLs**:

1. Land on www.blankcollar.ai
2. Click "Sign up" → redirected to app.blankcollar.ai/[auth]
3. Create account → land on dashboard, wizard opens
4. Complete the wizard → derived voice doc + 2-5 routine drafts
5. Capture "Remind me to call Mira on Friday" → goal created, classifier
   set kind=ephemeral and parsed the date
6. Go to Settings → Billing → Upgrade to Pro
7. Stripe Checkout opens → use a REAL card → completes
8. Watch the email arrive (welcome + Stripe receipt)
9. Refresh Settings → Billing → tier shows "Pro · ACTIVE"
10. Try to create a 4th agent on a free-tier account — get 402 with
    upgrade hint (tier gate works)

If all 10 pass, ship the announcement.
