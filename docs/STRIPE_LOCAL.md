# Stripe — local testing

Test the Stripe webhook receiver against your **local** stack using Stripe's
test mode + the official `stripe` CLI. No real card needed. ~10 minutes.

## What you'll have at the end

- A Stripe test-mode account
- The Stripe CLI forwarding live test events from Stripe → your local Paperclip
- A `whsec_…` signing secret in your `.env` so signature verification works
- Confirmed test events landing in `billing.stripe_event` (idempotent log)

## Prereq: local stack running

```bash
make doctor    # all 14 lines green
```

## 1. Create a Stripe account (3 min)

1. https://dashboard.stripe.com/register — sign up.
2. Stay in **Test mode** (toggle in the top-right). You don't need to activate the live account for this.

## 2. Install the Stripe CLI

```bash
brew install stripe/stripe-cli/stripe
stripe --version
```

If you don't use Homebrew: https://docs.stripe.com/stripe-cli#install

## 3. Log the CLI into your account

```bash
stripe login
```

It opens a browser tab — confirm the pairing code. The CLI now talks to your test-mode account.

## 4. Start the webhook listener

In a **dedicated terminal tab** (this stays running):

```bash
make stripe-listen
```

You'll see something like:

```
> Ready! You are using Stripe API Version [...]. Your webhook signing secret
  is whsec_abcd1234... (^C to quit)
```

**Copy that `whsec_...` value.** It's the signing secret Stripe will use for the events it forwards.

## 5. Put the secret in `.env`

In a **different terminal tab**:

```bash
nano .env
```

Set:

```env
STRIPE_WEBHOOK_SECRET=whsec_abcd1234...
```

Restart Paperclip so it picks up the new secret:

```bash
docker compose restart paperclip
docker compose logs paperclip --tail=5
```

## 6. Fire a test event

In yet another terminal tab:

```bash
make stripe-trigger EVENT=customer.created
```

Watch the **listener tab** — you should see something like:

```
2026-04-29 12:34:56  --> customer.created [evt_1abc...]
2026-04-29 12:34:56  <--  [200] POST http://localhost:3000/api/webhooks/stripe [evt_1abc...]
```

`[200]` = Paperclip verified the signature, recorded the event, returned OK.

## 7. Confirm the event landed

```bash
make stripe-events
```

You should see your event in the table:

```
       id           |       type       | processing_state |     received_at
--------------------+------------------+------------------+----------------------
 evt_1abc...        | customer.created | received         | 2026-04-29 12:34:56
```

Re-fire the same event (Stripe replays the same `evt_…id`):

```bash
make stripe-trigger EVENT=customer.created
```

Watch the listener tab — you'll get `[200]` again, but `make stripe-events` shows
the same row (no duplicate). Paperclip's response body for the second hit shows
`duplicate: true` because of the idempotent `ON CONFLICT DO NOTHING` insert.

## 8. Try other events

```bash
make stripe-trigger EVENT=customer.subscription.created
make stripe-trigger EVENT=invoice.payment_succeeded
make stripe-trigger EVENT=payment_intent.succeeded
```

`stripe trigger --help` lists everything Stripe can fake. The full Stripe
events catalogue: https://docs.stripe.com/cli/trigger#trigger-event

## Notes & gotchas

- **The listener must keep running.** When you close the tab, Stripe stops forwarding. Re-run `make stripe-listen`.
- **Each `stripe listen` session has a fresh `whsec_`.** If you stop and restart it, copy the new secret into `.env` and restart Paperclip.
- **Tokens vs webhook secrets** — the `whsec_…` is **only** for verifying inbound webhooks. To **call** Stripe APIs (create customers, etc.) you'd use the `sk_test_…` secret key, separately.
- **Production**: on Hostinger, you don't run the CLI. You add an HTTPS endpoint in the Stripe dashboard (`https://www.blankcollar.ai/api/webhooks/stripe`) and copy that endpoint's signing secret into the production `.env`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `503 stripe_disabled` | `STRIPE_WEBHOOK_SECRET` is unset or empty. Re-paste, restart paperclip. |
| `400 invalid_signature` | The secret in `.env` doesn't match the listener's `whsec_…`. Stripe rotates it on every `stripe listen` start — copy the latest. |
| `400 missing_signature` | Something stripped the `Stripe-Signature` header. Don't put a proxy between the CLI and localhost. |
| `make stripe-events` says `billing.stripe_event` doesn't exist | Paperclip creates the table on startup — restart paperclip and try again. |
| The CLI says "no API key found" | `stripe login` again. |
