#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — personal-deploy.sh
# -----------------------------------------------------------------------------
# The one-command personal-assistant deploy. Runs ON THE VPS (Hostinger web
# Terminal is fine) and takes a fresh-ish Ubuntu box all the way to "message
# your Telegram bot". Wraps: traefik parking → cloud-bootstrap (no Coolify) →
# clone → .env with generated secrets → preflight → build + up → doctor →
# make personal → Telegram webhook.
#
# Usage (paste into the VPS terminal as root):
#   bash <(curl -fsSL https://raw.githubusercontent.com/The-Blank-Collar/blankcollar-agentic-os/main/infra/scripts/personal-deploy.sh)
#
# Idempotent: re-running skips finished steps and never rotates secrets a
# live database already uses. Everything is logged to /root/bc-deploy.log —
# if a step fails, paste the tail of that file when asking for help.
#
# You'll be asked for (all optional except the domain):
#   - your public domain (e.g. os.blankcollar.ai — DNS A record must point here)
#   - TELEGRAM_BOT_TOKEN        (from @BotFather; empty = skip Telegram for now)
#   - PORTKEY_API_KEY + PORTKEY_VIRTUAL_KEY_ANTHROPIC
#                               (empty = FakeLLM mode: canned replies, no LLM)
#   - your name + email         (for the single-user org)
# -----------------------------------------------------------------------------
set -euo pipefail

LOG=/root/bc-deploy.log
exec > >(tee -a "$LOG") 2>&1

if [[ "${EUID}" -ne 0 ]]; then
  echo "✗ run as root (the Hostinger web Terminal already is)" >&2
  exit 1
fi

step() {
  echo
  echo "─── $* ────────────────────────────────────────────────────────────"
}

ask() {
  # ask VAR "prompt" "default" [hidden]  — reads from the terminal even when
  # this script is piped from curl.
  local var="$1" prompt="$2" default="${3:-}" hidden="${4:-}"
  local current="${!var:-}"
  if [[ -n "$current" ]]; then return 0; fi
  local suffix=""
  [[ -n "$default" ]] && suffix=" [$default]"
  if [[ "$hidden" == "hidden" ]]; then
    read -r -s -p "  $prompt$suffix: " "$var" < /dev/tty || true
    echo
  else
    read -r -p "  $prompt$suffix: " "$var" < /dev/tty || true
  fi
  if [[ -z "${!var}" && -n "$default" ]]; then
    printf -v "$var" '%s' "$default"
  fi
}

REPO_DIR=/root/code/blankcollar-agentic-os
RAW=https://raw.githubusercontent.com/The-Blank-Collar/blankcollar-agentic-os/main

# -----------------------------------------------------------------------------
step "1/8  Parking the template's Traefik (it holds ports 80/443)"
# -----------------------------------------------------------------------------
TRAEFIK_RUNNING="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i traefik || true)"
if [[ -n "$TRAEFIK_RUNNING" ]]; then
  while IFS= read -r name; do
    docker stop "$name"
    docker update --restart=no "$name" || true
    echo "  ✓ stopped + disabled: $name"
  done <<< "$TRAEFIK_RUNNING"
else
  echo "  · no running traefik container; nothing to park"
fi

# -----------------------------------------------------------------------------
step "2/8  Base packages + repo clone"
# -----------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null 2>&1 || apt-get install -y git
if ! docker compose version >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y docker-compose-plugin
fi
mkdir -p /root/code
if [[ -d "$REPO_DIR/.git" ]]; then
  echo "  · repo present — pulling latest main"
  git -C "$REPO_DIR" pull --ff-only origin main
else
  git clone https://github.com/The-Blank-Collar/blankcollar-agentic-os.git "$REPO_DIR"
fi
cd "$REPO_DIR"

# -----------------------------------------------------------------------------
step "3/8  Server hardening (swap, firewall, fail2ban — no Coolify)"
# -----------------------------------------------------------------------------
SKIP_COOLIFY=1 bash ./infra/scripts/cloud-bootstrap.sh

# -----------------------------------------------------------------------------
step "4/8  Configuration (.env)"
# -----------------------------------------------------------------------------
cd "$REPO_DIR"
[[ -f .env ]] || cp .env.example .env

set_env() {
  local var="$1" val="$2"
  if grep -qE "^${var}=" .env; then
    awk -v var="$var" -v val="$val" '
      BEGIN { done = 0 }
      $0 ~ "^"var"=" { if (!done) { print var"="val; done = 1 }; next }
      { print }
    ' .env > .env.tmp && mv .env.tmp .env
  else
    printf '%s=%s\n' "$var" "$val" >> .env
  fi
}

env_val() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }

# Generate a secret only if .env still carries the placeholder — re-runs
# must never rotate credentials a live database already uses.
ensure_secret() {
  local var="$1" placeholder="$2" gen="$3"
  local current; current="$(env_val "$var")"
  if [[ -z "$current" || "$current" == "$placeholder" ]]; then
    set_env "$var" "$($gen)"
    echo "  ✓ generated $var"
  else
    echo "  · $var already set; keeping"
  fi
}

gen_hex24()  { openssl rand -hex 24; }
gen_hex32()  { openssl rand -hex 32; }
gen_hex16()  { openssl rand -hex 16; }
gen_b64_32() { openssl rand -base64 32; }

CURRENT_DOMAIN="$(env_val PUBLIC_DOMAIN)"
if [[ -z "$CURRENT_DOMAIN" || "$CURRENT_DOMAIN" == "www.blankcollar.ai" ]]; then
  PUBLIC_DOMAIN=""
  ask PUBLIC_DOMAIN "Public domain for your assistant (DNS A record → this VPS)" "os.blankcollar.ai"
else
  PUBLIC_DOMAIN="$CURRENT_DOMAIN"
  echo "  · PUBLIC_DOMAIN already set: $PUBLIC_DOMAIN"
fi
BASE_DOMAIN="${PUBLIC_DOMAIN#*.}"

set_env COMPOSE_FILE "docker-compose.yml:docker-compose.prod.yml:docker-compose.personal.yml:docker-compose.caddy.yml"
set_env ENV production
set_env PUBLIC_DOMAIN "$PUBLIC_DOMAIN"
set_env NANGO_PUBLIC_DOMAIN "nango.${BASE_DOMAIN}"
set_env NANGO_UI_DOMAIN "nango-ui.${BASE_DOMAIN}"

ACME_CURRENT="$(env_val ACME_EMAIL)"
if [[ -z "$ACME_CURRENT" || "$ACME_CURRENT" == "agent@blankcollar.ai" ]]; then
  ACME_EMAIL=""
  ask ACME_EMAIL "Email for Let's Encrypt certificate notices" "admin@${BASE_DOMAIN}"
  set_env ACME_EMAIL "$ACME_EMAIL"
fi

ensure_secret POSTGRES_PASSWORD        "postgres"                                      gen_hex24
ensure_secret PAPERCLIP_AUTH_SECRET    "replace-me-with-a-32-byte-hex-string"          gen_hex32
ensure_secret NANGO_ENCRYPTION_KEY     "Lktpnnl7UNIPVQgJBL3EE9U4VQCwswksinu1HLxbfxg="  gen_b64_32
ensure_secret NANGO_DASHBOARD_PASSWORD "admin"                                         gen_hex16
ensure_secret TELEGRAM_WEBHOOK_SECRET  ""                                              gen_hex32
ensure_secret QDRANT_API_KEY           ""                                              gen_hex32

if [[ -z "$(env_val TELEGRAM_BOT_TOKEN)" ]]; then
  TELEGRAM_BOT_TOKEN=""
  ask TELEGRAM_BOT_TOKEN "TELEGRAM_BOT_TOKEN from @BotFather (Enter to skip for now)" "" hidden
  [[ -n "$TELEGRAM_BOT_TOKEN" ]] && set_env TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN"
fi
if [[ -z "$(env_val PORTKEY_API_KEY)" ]]; then
  PORTKEY_API_KEY=""
  ask PORTKEY_API_KEY "PORTKEY_API_KEY (Enter to skip → FakeLLM canned replies)" "" hidden
  [[ -n "$PORTKEY_API_KEY" ]] && set_env PORTKEY_API_KEY "$PORTKEY_API_KEY"
fi
if [[ -n "$(env_val PORTKEY_API_KEY)" && -z "$(env_val PORTKEY_VIRTUAL_KEY_ANTHROPIC)" ]]; then
  PORTKEY_VIRTUAL_KEY_ANTHROPIC=""
  ask PORTKEY_VIRTUAL_KEY_ANTHROPIC "PORTKEY_VIRTUAL_KEY_ANTHROPIC" "" hidden
  [[ -n "$PORTKEY_VIRTUAL_KEY_ANTHROPIC" ]] && set_env PORTKEY_VIRTUAL_KEY_ANTHROPIC "$PORTKEY_VIRTUAL_KEY_ANTHROPIC"
fi

# -----------------------------------------------------------------------------
step "5/8  Preflight gate"
# -----------------------------------------------------------------------------
./infra/scripts/preflight.sh

# -----------------------------------------------------------------------------
step "6/8  Build + start the stack (15-25 min on 2 cores — let it run)"
# -----------------------------------------------------------------------------
docker compose up -d --build

# -----------------------------------------------------------------------------
step "7/8  Health check"
# -----------------------------------------------------------------------------
DOCTOR_OK=0
for attempt in 1 2 3 4 5; do
  echo "  · doctor attempt $attempt/5"
  if ./infra/scripts/doctor.sh; then
    DOCTOR_OK=1
    break
  fi
  sleep 30
done
if [[ "$DOCTOR_OK" -ne 1 ]]; then
  echo "✗ doctor still failing after 5 attempts — paste the tail of $LOG for help" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
step "8/8  Personal mode + Telegram"
# -----------------------------------------------------------------------------
YOUR_NAME=""
YOUR_EMAIL=""
ask YOUR_NAME  "Your name (for the single-user org)" "You"
ask YOUR_EMAIL "Your email" "you@${BASE_DOMAIN}"
NAME="$YOUR_NAME" EMAIL="$YOUR_EMAIL" ./infra/scripts/personal.sh

if [[ -n "$(env_val TELEGRAM_BOT_TOKEN)" ]]; then
  ./infra/scripts/setup-telegram.sh "https://${PUBLIC_DOMAIN}"
else
  echo "  · no TELEGRAM_BOT_TOKEN — wire it later with:"
  echo "      cd $REPO_DIR && ./infra/scripts/setup-telegram.sh https://${PUBLIC_DOMAIN}"
fi

cat <<EOF

═══════════════════════════════════════════════════════════════════
✓ Personal assistant deployed.

   API     : https://${PUBLIC_DOMAIN}/api/health
   org     : single-user, owner = ${YOUR_NAME} <${YOUR_EMAIL}>
   agents  : Hermes · OpenClaw · LangGraph
   log     : ${LOG}

If DNS was added recently, the TLS certificate can take a minute —
Caddy retries automatically. Then: message your bot on Telegram.
═══════════════════════════════════════════════════════════════════
EOF
