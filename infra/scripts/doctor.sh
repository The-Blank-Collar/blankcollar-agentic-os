#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — doctor.sh
# Quick health check of the local stack. Exits 0 if everything is happy.
# -----------------------------------------------------------------------------
set -uo pipefail

# Allow port overrides from .env if present
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -f "$ROOT/.env" ]; then
  set -a; . "$ROOT/.env"; set +a
fi

PG_PORT=${POSTGRES_PORT:-5432}
QD_PORT=${QDRANT_HTTP_PORT:-6333}
PC_PORT=${PAPERCLIP_PORT:-3000}
HM_PORT=${HERMES_PORT:-8001}
OC_PORT=${OPENCLAW_PORT:-8002}
GB_PORT=${GBRAIN_PORT:-8003}

PASS=0; FAIL=0
ok()   { printf "\033[1;32m✅ %s\033[0m\n" "$*"; PASS=$((PASS+1)); }
bad()  { printf "\033[1;31m❌ %s\033[0m\n" "$*"; FAIL=$((FAIL+1)); }

check_http() {
  local name=$1 url=$2
  if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
    ok "$name responding ($url)"
  else
    bad "$name NOT responding ($url)"
  fi
}

check_container_health() {
  local name=$1
  local status
  status=$(docker inspect --format='{{.State.Health.Status}}' "$name" 2>/dev/null || echo "missing")
  case "$status" in
    healthy) ok "$name healthy" ;;
    starting) bad "$name still starting (try again in a moment)" ;;
    missing) bad "$name container is missing — run ./infra/scripts/bootstrap.sh" ;;
    *) bad "$name is $status" ;;
  esac
}

if ! docker info >/dev/null 2>&1; then
  bad "Docker daemon not reachable — start Docker Desktop"
  exit 1
fi
ok "Docker daemon reachable"

check_container_health bc_postgres
check_container_health bc_qdrant
check_container_health bc_gbrain
check_container_health bc_hermes
check_container_health bc_openclaw
check_container_health bc_paperclip
check_container_health bc_email_ingest

check_http "Qdrant"      "http://localhost:${QD_PORT}/healthz"
check_http "Paperclip"   "http://localhost:${PC_PORT}/api/health"
check_http "Hermes"      "http://localhost:${HM_PORT}/healthz"
check_http "OpenClaw"    "http://localhost:${OC_PORT}/healthz"
check_http "gbrain"      "http://localhost:${GB_PORT}/healthz"

# Postgres TCP probe (no psql dependency)
if (echo > /dev/tcp/localhost/"$PG_PORT") >/dev/null 2>&1; then
  ok "Postgres TCP open on :${PG_PORT}"
else
  bad "Postgres NOT reachable on :${PG_PORT}"
fi

echo
printf "Result: \033[1;32m%d passed\033[0m, \033[1;31m%d failed\033[0m\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
