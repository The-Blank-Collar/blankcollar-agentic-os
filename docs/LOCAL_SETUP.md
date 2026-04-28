# Local Setup — Mac + Docker Desktop

This guide is the long-form walkthrough of the Quick Start in the README. It assumes you've never set up the project before.

## 0. Prerequisites — install once

| Tool            | How to install                                                  |
|-----------------|-----------------------------------------------------------------|
| Docker Desktop  | https://www.docker.com/products/docker-desktop                  |
| Git             | `brew install git`                                              |
| (optional) jq   | `brew install jq` — nicer JSON output in `doctor.sh`            |
| (optional) psql | `brew install libpq && brew link --force libpq`                 |

After installing Docker Desktop, **launch it once** and wait for the whale icon to settle in your menu bar. From a terminal, confirm:

```bash
docker --version
docker compose version
```

Both should print versions. If `docker compose` isn't recognized, your Docker Desktop is too old — update it.

## 1. Clone

```bash
mkdir -p ~/code && cd ~/code
git clone https://github.com/The-Blank-Collar/blankcollar-agentic-os.git
cd blankcollar-agentic-os
```

## 2. Create your `.env`

```bash
cp .env.example .env
```

For Phase 0 you don't need to touch any value. The defaults run the local stack as-is.

> Optional: set `PAPERCLIP_AUTH_SECRET` to a real value with `openssl rand -hex 32`. It's unused in Phase 0 but it's a good habit.

## 3. Bootstrap

```bash
./infra/scripts/bootstrap.sh
```

This script:

- checks Docker is running,
- pulls all images,
- starts the stack,
- waits for healthchecks,
- prints a summary table of URLs.

If the script isn't executable yet:

```bash
chmod +x infra/scripts/*.sh
./infra/scripts/bootstrap.sh
```

## 4. Verify

```bash
./infra/scripts/doctor.sh
```

Expected output (abbreviated):

```
✅ docker daemon reachable
✅ bc_postgres   healthy
✅ bc_qdrant     healthy
✅ bc_paperclip  responding on :3000
✅ bc_hermes     responding on :8001
✅ bc_openclaw   responding on :8002
✅ bc_gbrain     responding on :8003
```

Open in your browser:

- http://localhost:3000 — Paperclip placeholder
- http://localhost:6333/dashboard — Qdrant UI

## 5. Inspect Postgres (optional)

```bash
psql postgresql://postgres:postgres@localhost:5432/blankcollar -c "\dn"
psql postgresql://postgres:postgres@localhost:5432/blankcollar -c "\dt core.*"
psql postgresql://postgres:postgres@localhost:5432/blankcollar \
  -c "SELECT slug, name FROM core.organization;"
```

You should see the `core`, `ops`, `brain` schemas and the seeded demo organization.

If you prefer a UI, start pgAdmin with the `tools` profile:

```bash
docker compose --profile tools up -d pgadmin
open http://localhost:5050   # login with PGADMIN_EMAIL / PGADMIN_PASSWORD
```

## 6. Stop, restart, reset

```bash
docker compose stop                    # stop without removing
docker compose start                   # start again
docker compose down                    # remove containers, KEEP data
docker compose down -v                 # remove containers AND wipe data
./infra/scripts/reset.sh               # interactive, asks before wiping
```

## Troubleshooting

### "port is already allocated"

Another process is using one of `3000 / 5432 / 6333 / 6334 / 8001 / 8002 / 8003`. Either stop that process, or override the port in `.env` (e.g. `POSTGRES_PORT=5433`) and re-run `docker compose up -d`.

### "Docker Desktop is not running"

Open `/Applications/Docker.app`, wait for the whale to stop animating, then retry.

### Postgres won't start: "database files are incompatible"

Your volume was created by an older Postgres. Wipe it:

```bash
docker compose down -v
./infra/scripts/bootstrap.sh
```

> ⚠️ This deletes local data. Fine in Phase 0 — there's nothing real to lose.

### Qdrant healthcheck flaps

Cold-start can take 10–20s on first boot. Wait, then re-run `./infra/scripts/doctor.sh`.

### Placeholder pages show nginx default instead of the Blank Collar card

The volume mount didn't pick up the static file. Confirm `apps/<service>/public/index.html` exists, then `docker compose restart <service>`.

### `docker compose` says volumes already exist with different config

If you've previously run a different project with the same volume names, the named volumes can collide. We prefix everything with `bc_`, but if you've manually created e.g. `bc_postgres_data` for another project:

```bash
docker volume ls | grep bc_
docker volume rm bc_postgres_data bc_qdrant_data bc_pgadmin_data
```

## What "fully working" looks like

- `docker compose ps` shows all services as `running` (and `healthy` where applicable).
- `./infra/scripts/doctor.sh` exits 0.
- `http://localhost:3000` shows the Paperclip placeholder card (dark theme).
- `psql ... -c "SELECT count(*) FROM core.department;"` returns `5` (the seeded departments).
