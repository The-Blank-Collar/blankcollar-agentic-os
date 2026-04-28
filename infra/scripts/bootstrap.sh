#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — bootstrap.sh
# First-run setup for the local stack on macOS / Linux.
# -----------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

say()  { printf "\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m✅ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m⚠️  %s\033[0m\n" "$*"; }
err()  { printf "\033[1;31m❌ %s\033[0m\n" "$*" >&2; }

# 1. Docker daemon
say "Checking Docker daemon"
if ! docker info >/dev/null 2>&1; then
  err "Docker is not running. Start Docker Desktop (whale icon in menu bar) and re-run."
  exit 1
fi
ok "Docker is running"

# 2. .env file
say "Checking .env"
if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from .env.example"
else
  ok ".env already exists"
fi

# 3. Pre-pull just the registry-only services (postgres, qdrant) so we
#    don't fight with compose's auto-pull logic.
say "Pulling postgres + qdrant (registry images only)"
docker compose pull postgres qdrant

# 4. Build local images first, explicitly. Don't combine with `up` — keep
#    the steps separate so a build failure is unambiguous.
say "Building local images (first run takes 5–10 minutes; subsequent runs are seconds)"
docker compose build

# 5. Start. `--pull never` forbids any registry pull attempts (postgres +
#    qdrant were already pulled above, locally-built images now exist
#    after the build, so nothing else needs fetching).
say "Starting stack"
docker compose up -d --pull never

# Verify the build actually produced the tagged images.
say "Verifying built images are present"
missing=()
for img in blankcollar/gbrain:0.1.0 blankcollar/paperclip:0.1.0 \
           blankcollar/hermes:0.1.0 blankcollar/openclaw:0.1.0 \
           blankcollar/email-ingest:0.1.0; do
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    missing+=("$img")
  fi
done
if [ "${#missing[@]}" -ne 0 ]; then
  err "These images did not build successfully: ${missing[*]}"
  err "Run: docker compose build  — and look for the failing service."
  exit 1
fi
ok "All local images present"

# 5. Wait for healthy. For services with no in-container healthcheck
#    (e.g. qdrant — see docker-compose.yml note), accept "running" as
#    good enough; downstream services have their own retries.
say "Waiting for services to become healthy"
for service in bc_postgres bc_qdrant bc_gbrain bc_hermes bc_openclaw bc_paperclip bc_email_ingest; do
  printf "   %s " "$service"
  status=""
  for _ in $(seq 1 60); do
    status=$(docker inspect --format='{{.State.Health.Status}}' "$service" 2>/dev/null || true)
    if [ "$status" = "healthy" ]; then
      printf "\033[1;32mhealthy\033[0m\n"
      break
    fi
    # No healthcheck configured? Accept "running" as ready.
    if [ -z "$status" ]; then
      running=$(docker inspect --format='{{.State.Status}}' "$service" 2>/dev/null || echo "missing")
      if [ "$running" = "running" ]; then
        printf "\033[1;33mrunning (no healthcheck)\033[0m\n"
        status="healthy"   # treat as ok for the next check
        break
      fi
    fi
    printf "."
    sleep 1
  done
  if [ "$status" != "healthy" ]; then
    err "$service did not become healthy in time"
    docker compose logs --tail=80 "${service#bc_}"
    exit 1
  fi
done

# 6. Summary
say "Stack is up. Endpoints:"
cat <<EOF

  📎 Paperclip   http://localhost:${PAPERCLIP_PORT:-3000}
  🪽 Hermes      http://localhost:${HERMES_PORT:-8001}
  🦾 OpenClaw    http://localhost:${OPENCLAW_PORT:-8002}
  🧠 gbrain      http://localhost:${GBRAIN_PORT:-8003}
  🐘 Postgres    postgresql://${POSTGRES_USER:-postgres}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-blankcollar}
  📦 Qdrant      http://localhost:${QDRANT_HTTP_PORT:-6333}/dashboard

Next: ./infra/scripts/doctor.sh
EOF
