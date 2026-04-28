# Real Paperclip — primary command centre (Docker, host networking)

The upstream **paperclipai** package
(https://github.com/paperclipai/paperclip) runs as a Docker service in our
stack at **http://localhost:3100**, alongside our custom orchestrator at
`:3000` (which keeps owning Stripe webhooks, Supabase JWT, and our custom
audit log).

## Why this works (the short version)

paperclipai's `local_trusted` mode hard-locks a `127.0.0.1` bind regardless
of every flag, env var, or config patch we tried. So instead of fighting it,
we use Docker's **host networking** (`network_mode: host`): the container
shares your Mac's network namespace, so paperclipai's `127.0.0.1:3100` *is*
your Mac's `localhost:3100`. No port-forward, no socat, no auth wall.

## Requirements

- **Docker Desktop 4.34+** (host networking on Mac is GA from there).
  Check with `docker --version`. Older? Update Docker Desktop or run
  paperclipai natively with `npx paperclipai@latest run`.
- Native `npx paperclipai run` **must not be running** on your Mac when
  the Docker version starts — they'd fight for port 3100.

## Bring it up

```bash
make bootstrap
```

(or `docker compose up -d` if everything else is already running). First
boot of `paperclip-real` takes ~2 min — fetching the `paperclipai` npm
package, running `onboard --yes`, then starting the server.

```bash
make doctor
```

Should be all green, including `Paperclip(real) responding (http://localhost:3100/api/health)`.

```bash
open http://localhost:3100
```

Loads straight into Paperclip's dashboard. `local_trusted` mode = no auth wall.

## Where everything lives

| Service | URL |
|---|---|
| **Paperclip (real)** — command centre | http://localhost:3100 |
| Paperclip (legacy / integrations) | http://localhost:3000 |
| Hermes | http://localhost:8001 |
| OpenClaw | http://localhost:8002 |
| gbrain | http://localhost:8003 |
| Postgres | localhost:5432 |
| Qdrant | http://localhost:6333 |

## Registering Hermes + OpenClaw inside Paperclip's UI

In paperclip's UI (whatever the upstream calls it — "Agents", "Hire an agent", etc.), add HTTP-webhook agents pointing at our Docker services:

| Name | Endpoint | Health |
|---|---|---|
| `Hermes` | `http://localhost:8001/run` | `http://localhost:8001/healthz` |
| `OpenClaw` | `http://localhost:8002/run` | `http://localhost:8002/healthz` |

(Because paperclip-real uses host networking, it reaches the other Docker
services via host-published ports — same URLs as you'd use from a browser.)

## Persistence

paperclipai's state lives in the `bc_paperclip_real_data` Docker volume,
mounted at `/home/node/.paperclip` inside the container. Survives restarts.
Wipe with:

```bash
docker compose stop paperclip-real
docker compose rm -f paperclip-real
docker volume rm bc_paperclip_real_data
make bootstrap     # onboard re-runs from scratch
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `bc_paperclip_real is restarting` | `docker logs bc_paperclip_real --tail=80` — look for `[paperclip][FATAL]` write-probe lines (volume permissions). Wipe & rebuild as above. |
| `:3100 connection refused` from Mac | Native `paperclipai run` already running? `pkill -f paperclipai` then `docker compose restart paperclip-real`. |
| `network_mode: host` rejected by compose | Docker Desktop too old. Update to 4.34+, or fall back to running paperclipai natively (`npx paperclipai@latest run` from your home folder, NOT the repo dir). |
| Onboard re-runs every boot | `bc_paperclip_real_data` volume isn't persisting. Check `docker volume ls \| grep paperclip_real`. |
| Login screen instead of dashboard | You're in `--bind lan` (authenticated) mode somehow. The default `local_trusted` skips auth. Wipe the volume and rebuild. |
