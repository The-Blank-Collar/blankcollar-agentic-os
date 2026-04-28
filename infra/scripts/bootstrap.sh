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

# 3. Pull images that come from a registry (postgres, qdrant, …) — skip
#    services that build locally so we don't fail with "pull access denied".
#    --ignore-buildable is supported by docker compose 2.22+; if older, we
#    silently skip the pull and let `up --build` handle everything.
say "Pulling registry images"
if ! docker compose pull --ignore-buildable 2>/dev/null; then
  warn "skipping pull (older docker compose without --ignore-buildable)"
fi

# 4. Build local images (gbrain, paperclip, hermes, openclaw, email-ingest)
say "Building local images (this is the slow step on first run; minutes, not seconds)"
docker compose build

# 5. Up
say "Starting stack"
docker compose up -d

# 5. Wait for healthy
say "Waiting for services to become healthy"
for service in bc_postgres bc_qdrant bc_gbrain bc_hermes bc_openclaw bc_paperclip bc_email_ingest; do
  printf "   %s " "$service"
  for _ in $(seq 1 60); do
    status=$(docker inspect --format='{{.State.Health.Status}}' "$service" 2>/dev/null || echo "missing")
    if [ "$status" = "healthy" ]; then
      printf "\033[1;32mhealthy\033[0m\n"
      break
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
