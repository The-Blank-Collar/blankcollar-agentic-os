# Hostinger Deploy Guide

End-to-end walkthrough for putting Blank Collar Agentic OS on a Hostinger
**KVM 8** VPS, fronted by Caddy auto-TLS, with Nexos.ai, Oxylabs AI Studio,
and the dedicated `agent@blankcollar.ai` mailbox all wired in.

> **Order this assumes you bought:** KVM 8 (12-month), Nexos AI Credits 100,
> Oxylabs Credits 10000, Domain (`blankcollar.ai`), Domain privacy,
> Dedicated AI email (1 mailbox at `agent@blankcollar.ai`).

---

## 0. Prereqs on your laptop

- SSH key uploaded in Hostinger's *VPS → SSH Keys* panel (recommended over passwords)
- Git, Docker Desktop installed locally so you can test before pushing
- A working clone of the repo

## 1. Provision the VPS

1. Hostinger panel → *VPS → blankcollar* → **Operating system → Reinstall**.
2. Pick **Ubuntu 24.04 with Docker** (template). Saves you the `apt install docker.io` dance.
3. Once ready, copy the **public IP**.

## 2. Point DNS at the VPS

In Hostinger's *Domains → blankcollar.ai → DNS Zone Editor*:

| Type | Name      | Value | TTL | What it serves |
|---|---|---|---|---|
| A    | `@`       | `<vps-ip>` | 300 | apex (optional redirect to www) |
| A    | `www`     | `<vps-ip>` | 300 | dashboard + agent API + Stripe webhooks (Caddy → paperclip) |
| A    | `nango`   | `<vps-ip>` | 300 | Nango API — OAuth callbacks land here (Caddy → nango:3003) |
| A    | `nango-ui`| `<vps-ip>` | 300 | Nango Connect UI — admin only (Caddy → nango:3009) |
| MX   | `@`       | (managed by Hostinger AI mail — leave default) | — | inbound mail for `agent@blankcollar.ai` |

DNS usually propagates in 5–30 min. Confirm all four resolve:

```bash
for n in www nango nango-ui; do dig +short ${n}.blankcollar.ai; done
```

## 3. SSH in and harden a little

```bash
ssh root@<vps-ip>

# Create a non-root user (work as that user from now on)
adduser --gecos "" bc
usermod -aG sudo bc
usermod -aG docker bc
mkdir -p /home/bc/.ssh
cp ~/.ssh/authorized_keys /home/bc/.ssh/
chown -R bc:bc /home/bc/.ssh
chmod 700 /home/bc/.ssh && chmod 600 /home/bc/.ssh/authorized_keys

# Disable root SSH + password auth (after confirming you can ssh as bc)
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload sshd

# Open the firewall (Caddy needs 80+443; SSH stays 22)
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp     # HTTP/3
ufw --force enable
```

Switch to the `bc` user for everything below: `ssh bc@<vps-ip>`.

## 4. Clone the repo

```bash
mkdir -p ~/code && cd ~/code
git clone https://github.com/The-Blank-Collar/blankcollar-agentic-os.git
cd blankcollar-agentic-os
```

## 5. Configure `.env` for production

```bash
cp .env.example .env
nano .env
```

Fill in **at minimum** these values:

```env
ENV=production
LOG_LEVEL=info
PUBLIC_DOMAIN=www.blankcollar.ai
ACME_EMAIL=agent@blankcollar.ai

# --- strong secrets (use openssl rand -hex 32) ---
POSTGRES_PASSWORD=<rotate from default>
PAPERCLIP_AUTH_SECRET=<openssl rand -hex 32>
QDRANT_API_KEY=<openssl rand -hex 32>

# --- Nexos.ai (your Hostinger AI credits) ---
NEXOS_API_KEY=nx-...
NEXOS_BASE_URL=https://api.nexos.ai/v1
NEXOS_MODEL=claude-sonnet

# --- Oxylabs AI Studio (your Oxylabs credits) ---
OXYLABS_API_KEY=...
# Adjust if your account dashboard's "Integration Code" panel differs:
OXYLABS_BASE_URL=https://api.aistudio.oxylabs.io
OXYLABS_SEARCH_PATH=/v1/search

# --- agent@blankcollar.ai mailbox (Hostinger AI mail) ---
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=587
SMTP_USER=agent@blankcollar.ai
SMTP_PASSWORD=<from Hostinger mail panel>
SMTP_FROM=agent@blankcollar.ai

IMAP_HOST=imap.hostinger.com
IMAP_PORT=993
IMAP_USER=agent@blankcollar.ai
IMAP_PASSWORD=<same>
IMAP_USE_SSL=true

# --- Supabase (when you're ready to flip auth on) ---
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_JWT_SECRET=<from Settings → API → JWT Secret>
PAPERCLIP_AUTH_ENFORCE=false   # flip to true once users are provisioned

# --- Stripe (when you're ready) ---
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Confirm Hostinger's actual SMTP/IMAP host names** — they sometimes serve
mailboxes from `smtp.titan.email` or similar; the panel page for the mailbox
shows the right values.

## 6. Preflight (gate before first deploy)

```bash
make preflight
```

Or directly: `./infra/scripts/preflight.sh`. This refuses to pass if your
`.env` still carries any of the local-only defaults that would be
disastrous in prod:

- `NANGO_ENCRYPTION_KEY` placeholder (rotate with `openssl rand -base64 32`)
- `PAPERCLIP_AUTH_SECRET` placeholder (rotate with `openssl rand -hex 32`)
- `NANGO_DASHBOARD_PASSWORD=admin`
- Missing `PUBLIC_DOMAIN`, `NANGO_PUBLIC_DOMAIN`, `NANGO_UI_DOMAIN`, `ACME_EMAIL`
- Missing `brand/<BRAND_NAME>.md`
- `docker compose config -q` failing on the merged base + prod files

It surfaces the rest as warnings (e.g. `STRIPE_WEBHOOK_SECRET` empty —
fine if you haven't wired Stripe yet, but webhook calls will return 503).

Fix every `✗` line; warnings are judgement calls.

## 7. First deploy

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

This builds local images (paperclip, hermes, openclaw, gbrain, email-ingest),
pulls postgres/qdrant/caddy, applies `.env`, starts everything, and Caddy
auto-issues a Let's Encrypt cert for `${PUBLIC_DOMAIN}`.

Watch the cert issuance:

```bash
docker compose logs -f caddy
```

Wait for `certificate obtained successfully`.

## 8. Smoke test

```bash
./infra/scripts/doctor.sh
```

All ✅. Then from anywhere:

```bash
curl -fsSI https://www.blankcollar.ai/api/health
# HTTP/2 200
```

Open https://www.blankcollar.ai in a browser — the Paperclip dashboard.

Run the demo: create a goal *"Summarise https://news.ycombinator.com/ for me."*,
click **Generate plan** → **Run plan**. Watch the runs go through. Inspect:

```bash
docker exec bc_postgres psql -U postgres -d blankcollar \
  -c "SELECT kind, title FROM brain.memory ORDER BY created_at DESC LIMIT 5;"
```

You should see a `document` (HN page) and an `episode` (Hermes summary,
written via Nexos.ai using your credits).

## 9. Configure Stripe / Supabase (optional, when ready)

### Stripe webhook

In Stripe Dashboard → *Developers → Webhooks → Add endpoint*:

- URL: `https://www.blankcollar.ai/api/webhooks/stripe`
- Events: start with `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`
- Copy the signing secret → `.env` `STRIPE_WEBHOOK_SECRET`
- `docker compose -f docker-compose.yml -f docker-compose.prod.yml restart paperclip`
- Send a test event from Stripe; confirm a row in `billing.stripe_event`.

### Supabase auth (when you're ready to gate the dashboard)

1. Create a Supabase project.
2. Settings → API → JWT Secret → `.env` as `SUPABASE_JWT_SECRET`.
3. Provision yourself: insert a row into `core.user_account` matching your
   Supabase email, plus an `owner` row in `core.role_assignment`.
4. Restart paperclip; confirm logs say `auth=supabase enforce=false`.
5. Once you can sign in (Phase 6 will land the UI), flip
   `PAPERCLIP_AUTH_ENFORCE=true` and restart.

## 10. Subsequent deploys

From your laptop:

```bash
./infra/scripts/deploy.sh bc@<vps-ip>
```

Or from the VPS:

```bash
cd ~/code/blankcollar-agentic-os && ./infra/scripts/deploy.sh local
```

## 11. Backups

The KVM 8 ships with weekly backups in Hostinger's panel. On top of that,
take a Postgres dump nightly to your home machine:

```bash
ssh bc@<vps-ip> 'docker exec bc_postgres pg_dump -U postgres -Fc blankcollar' \
  > ~/backups/bc-$(date +%F).dump
```

Restore is in [`docs/BACKUP_RESTORE.md`](BACKUP_RESTORE.md).

## 12. Troubleshooting

### "no certificate available" on Caddy

DNS hasn't propagated, or your firewall blocks 80/443. Check:

```bash
dig +short www.blankcollar.ai
docker logs bc_caddy --tail 200
sudo ufw status
```

Caddy won't get a cert until your A record points at the VPS *and* port 80
reaches it (Let's Encrypt's HTTP-01 challenge).

### Hermes returns "FAKE-LLM" text

`NEXOS_API_KEY` isn't set — Hermes fell back to the deterministic stub.
Fix `.env`, restart `hermes`.

### `email-ingest` is "starting" forever

The healthcheck looks at a heartbeat file. The most common cause is wrong
IMAP credentials — check `docker logs bc_email_ingest`. Until valid
credentials are set, the service idles in heartbeat mode (still healthy).

### Stripe webhook returns 400 "invalid_signature"

`STRIPE_WEBHOOK_SECRET` doesn't match the signing secret on the Stripe
endpoint, or a proxy in front of Caddy is mutating the body. Caddy itself
forwards `/api/webhooks/*` raw — re-copy the secret from Stripe.

### `bc_paperclip` stuck unhealthy

Usually means it can't reach Postgres. Check:

```bash
docker exec bc_paperclip node -e "fetch('http://localhost:80/api/health').then(r=>r.json()).then(console.log)"
```

The `probes.postgres.ok` field tells you if the DB connection works.

---

## Production sanity checklist

- [ ] `make preflight` exits 0 (no hard errors; warnings reviewed)
- [ ] DNS for `www`, `nango`, `nango-ui` all resolve to the VPS IP
- [ ] `https://www.blankcollar.ai/api/health` returns `{ ok: true }`
- [ ] `https://nango.blankcollar.ai/health` returns `{ status: "ok" }`
- [ ] `./infra/scripts/doctor.sh` exits 0 on the VPS
- [ ] `POSTGRES_PASSWORD`, `PAPERCLIP_AUTH_SECRET`, `NANGO_ENCRYPTION_KEY`, `NANGO_DASHBOARD_PASSWORD` are NOT defaults
- [ ] No service except `bc_caddy` is reachable on the public internet (`nmap -p 80,443,5432,6333,3000,3003,3009,7474,7687,8001-8005 <vps-ip>` from outside the network → only 80/443 open)
- [ ] Hermes shows `provider: "nexos"` on `/healthz` and prepends `[Brand Foundation]` to its prompts
- [ ] OpenClaw shows the `web.search` skill with `OXYLABS_API_KEY` populated and `nango.invoke` available
- [ ] A test email to `agent@blankcollar.ai` lands as a `conversation` memory + a `draft` goal
- [ ] Stripe test event lands a row in `billing.stripe_event`
- [ ] Daily backup is running (cron or local pull)
