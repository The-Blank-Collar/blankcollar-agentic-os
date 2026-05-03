#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — setup-telegram.sh
# Registers the Telegram webhook for your bot, pointing at your paperclip
# server's public URL. Idempotent — safe to re-run after restarting ngrok.
#
# Prereqs in .env:
#   TELEGRAM_BOT_TOKEN       (from @BotFather)
#   TELEGRAM_WEBHOOK_SECRET  (any random string; openssl rand -hex 32 works)
#
# Usage:
#   ./infra/scripts/setup-telegram.sh https://<your-public-host>/api/webhooks/telegram
#
# If you pass just the hostname (no path), the script appends the route for
# you so beginners don't have to remember the suffix.
# -----------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ .env not found at $ENV_FILE — copy .env.example first." >&2
  exit 1
fi

# Tiny .env loader: accept only KEY=VALUE lines. Skip blanks/comments.
while IFS='=' read -r key val; do
  case "$key" in ''|\#*) continue ;; esac
  case "$key" in [A-Za-z_][A-Za-z_0-9]*) ;; *) continue ;; esac
  case "$val" in \"*\") val=${val#\"}; val=${val%\"} ;; \'*\') val=${val#\'}; val=${val%\'} ;; esac
  export "$key=$val"
done < "$ENV_FILE"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "✗ TELEGRAM_BOT_TOKEN not set in .env — paste the token from @BotFather." >&2
  exit 1
fi
if [ -z "${TELEGRAM_WEBHOOK_SECRET:-}" ]; then
  echo "✗ TELEGRAM_WEBHOOK_SECRET not set in .env." >&2
  echo "   Generate one with:  openssl rand -hex 32" >&2
  exit 1
fi

if [ $# -lt 1 ]; then
  cat <<EOF >&2
usage: $0 <public-url>

Examples:
  $0 https://abc123.ngrok-free.app
  $0 https://abc123.ngrok-free.app/api/webhooks/telegram
  $0 https://blankcollar.ai/api/webhooks/telegram

The public URL is whatever Telegram can reach. For local dev:
  - Run paperclip:           make up
  - Start ngrok in tab 2:    ngrok http 3001
  - Pass the https URL ngrok prints:  $0 https://abc123.ngrok-free.app
EOF
  exit 2
fi

URL_INPUT="$1"
case "$URL_INPUT" in
  *"/api/webhooks/telegram") FULL_URL="$URL_INPUT" ;;
  */)                        FULL_URL="${URL_INPUT}api/webhooks/telegram" ;;
  *)                         FULL_URL="${URL_INPUT}/api/webhooks/telegram" ;;
esac

case "$FULL_URL" in
  https://*) ;;
  *)
    echo "✗ Telegram requires HTTPS. Got: $FULL_URL" >&2
    exit 1
    ;;
esac

# Verify the bot token works at all before we wire it up.
ME_RESPONSE=$(curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" || true)
if [ -z "$ME_RESPONSE" ]; then
  echo "✗ Couldn't reach Telegram (network) or token is rejected. Check TELEGRAM_BOT_TOKEN." >&2
  exit 1
fi
case "$ME_RESPONSE" in
  *'"ok":true'*) ;;
  *)
    echo "✗ Telegram rejected the token. Response was:" >&2
    echo "  $ME_RESPONSE" >&2
    exit 1
    ;;
esac

BOT_USERNAME=$(echo "$ME_RESPONSE" | grep -oE '"username":"[^"]*"' | head -1 | sed 's/"username":"\(.*\)"/\1/')
echo "✓ Token valid — bot is @${BOT_USERNAME}"

# Register the webhook.
RESPONSE=$(curl -fsS -X POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "$(cat <<JSON
{
  "url": "${FULL_URL}",
  "secret_token": "${TELEGRAM_WEBHOOK_SECRET}",
  "allowed_updates": ["message"],
  "drop_pending_updates": true
}
JSON
)" || true)

case "$RESPONSE" in
  *'"ok":true'*)
    echo "✓ Webhook registered → ${FULL_URL}"
    echo
    echo "Test it:"
    echo "  1. Open Telegram, find @${BOT_USERNAME}, send any message."
    echo "  2. Bot replies (via Hermes through Portkey)."
    echo "  3. Watch \`docker logs bc_paperclip --tail 30 -f\` for inbound updates."
    ;;
  *)
    echo "✗ setWebhook failed:" >&2
    echo "  $RESPONSE" >&2
    exit 1
    ;;
esac
