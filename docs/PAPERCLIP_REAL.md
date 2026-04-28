# Real Paperclip — primary command centre

This wires the upstream **paperclipai** package
(https://github.com/paperclipai/paperclip) into our Docker stack as the
primary user-facing command centre at **http://localhost:3100**.

It runs **alongside** our custom orchestrator at `:3000`, not instead of it —
the legacy service still owns the integrations the upstream project doesn't
ship (Stripe webhook + idempotent event log, Supabase JWT, custom
gbrain-aware planner, our `core.audit_log`).

## What you see at each URL

| URL | Service | Owns |
|---|---|---|
| http://localhost:**3100** | Real Paperclip (upstream) | Org chart · Goals · Heartbeats · Cost control · Ticket system · Governance |
| http://localhost:**3000** | Custom orchestrator (legacy) | Stripe webhook (`/api/webhooks/stripe`) · Supabase JWT verifier · gbrain-aware plan generator · `core.audit_log` |
| http://localhost:**8001/8002/8003** | Hermes / OpenClaw / gbrain | Workforce + memory layer (consumed by both orchestrators) |

## How real Paperclip is plugged in

- Image: `blankcollar/paperclip-real:0.1.0` (built locally from `apps/paperclip-real/Dockerfile`)
- Wraps `npx paperclipai@latest` — runs `onboard --yes` once on first boot, then `run`
- Persistent state at `/home/node/.paperclip` → `bc_paperclip_real_data` Docker volume
- **Embedded Postgres** on its own port inside the container — does NOT touch our shared `bc_postgres` (no schema collision)
- Bound to `0.0.0.0:3100` inside the container; mapped to host `${PAPERCLIP_REAL_PORT:-3100}`

## First-time bring-up

If the npx-installed copy is still running on your Mac, **stop it first**
(it's holding port 3100):

```bash
# in the terminal tab running `paperclipai run`
# press Ctrl+C
```

Then:

```bash
git pull
make bootstrap         # builds the new image; first build is slow once
make doctor            # confirms bc_paperclip_real running + /api/health responding
open http://localhost:3100
```

## Registering Hermes + OpenClaw as agents inside real Paperclip

Real Paperclip discovers agents through its UI ("hire an agent"). Our existing
services already speak HTTP and live on the same Docker network, so they're
reachable from the Paperclip container at:

| Agent | URL inside the cluster | URL from your Mac |
|---|---|---|
| Hermes (general reasoning) | `http://hermes:80` | `http://localhost:8001` |
| OpenClaw (web actions) | `http://openclaw:80` | `http://localhost:8002` |

**Steps in the Paperclip UI** (these are version-dependent — adjust to whatever the upstream UI calls them):

1. Sign in / pick a workspace.
2. Open the **Agents** / **Hire an agent** screen.
3. Add a new agent of kind **HTTP webhook**.
   - Name: `Hermes`
   - Endpoint: `http://hermes:80/run`
   - Health URL: `http://hermes:80/healthz`
4. Add another agent.
   - Name: `OpenClaw`
   - Endpoint: `http://openclaw:80/run`
   - Health URL: `http://openclaw:80/healthz`
5. Save. From the Paperclip UI you can now assign tasks to either.

The `/run` and `/healthz` shapes are documented in
[`docs/AGENTS.md`](AGENTS.md) and [`docs/API.md`](API.md#agent-adapter-contract-l3).

## What still happens via the legacy orchestrator at :3000

These features are not (yet) part of the upstream Paperclip and continue to
live in our custom service:

- **Stripe webhooks** at `POST http://localhost:3000/api/webhooks/stripe`
  (HMAC-verified, idempotent log in `billing.stripe_event` — see
  [`STRIPE_LOCAL.md`](STRIPE_LOCAL.md))
- **Supabase JWT** verification middleware (see
  [`SUPABASE_LOCAL.md`](SUPABASE_LOCAL.md))
- The 5 starter goal templates in `templates/goals/`
- Our `core.audit_log`, `brain.memory`, `ops.goal/run/agent` schemas
- The gbrain-aware plan generator that produces `web.fetch → summarise → decide`
  plans automatically when a goal contains a URL

We can migrate these into Paperclip plugins later — but for now, both
orchestrators run side-by-side and you pick whichever surface fits the moment.

## Cleaning up the npx-installed copy

If you ran `npx paperclipai onboard --yes` on your Mac before we dockerized it,
the config is at `~/.paperclip/instances/default/`. The Docker version uses a
**separate** config inside the container volume, so they don't share state.
Either is fine to keep around. To wipe the laptop-side copy entirely:

```bash
rm -rf ~/.paperclip
```

(Don't do this if you've added agents/data to the laptop-side copy you want
to keep — Docker has its own copy and your laptop-side one is independent.)

## Troubleshooting

| Symptom | Fix |
|---|---|
| `bc_paperclip_real` stuck `starting` for >2min on first boot | First `npx paperclipai` install is slow inside the container — wait. Check `docker compose logs paperclip-real --tail=80`. |
| `:3100` → "Connection refused" | The `paperclipai` process inside is bound to localhost, not 0.0.0.0. Confirm `PAPERCLIP_BIND=0.0.0.0` is set in compose. |
| Onboard re-runs on every restart | The `bc_paperclip_real_data` volume isn't mounted — check `docker volume ls \| grep paperclip_real`. |
| `getaddrinfo ENOTFOUND postgres` | The container is somehow reading our project `.env` and trying to use our Postgres. Real Paperclip should use its embedded one — `docker exec bc_paperclip_real cat /home/node/.paperclip/instances/default/config.json` and verify `database: embedded-postgres`. |
