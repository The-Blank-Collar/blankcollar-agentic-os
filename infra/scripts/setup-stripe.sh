#!/usr/bin/env bash
#
# setup-stripe.sh — interactive Stripe Checkout + webhook wiring (Phase 8.2).
#
# Walks the operator through pasting the values they copied from the
# Stripe dashboard + the webhook secret from `stripe listen`, writes
# them into .env (preserving everything else), turns on tier gating,
# and offers to restart paperclip so the new env takes effect.
#
# Usage:
#     make setup-stripe
#     # or directly:
#     ./infra/scripts/setup-stripe.sh
#
# POSIX-friendly: works on macOS bash 3.2 and Linux bash 5.x.

set -eu

# Move to repo root.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE=".env"
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"

# Colours — only when stdout is a terminal.
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  CYAN="$(printf '\033[36m')"
  GREY="$(printf '\033[90m')"
  DIM="$(printf '\033[2m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""; GREEN=""; YELLOW=""; CYAN=""; GREY=""; DIM=""; RESET=""
fi

# --- helpers (mirror setup-supabase.sh) --------------------------------------

current_value() {
  local var="$1"
  awk -F= -v var="$var" '
    $1 == var { sub(/^[^=]*=/, ""); print; exit }
  ' "$ENV_FILE"
}

set_env() {
  local var="$1"
  local val="$2"
  if grep -qE "^${var}=" "$ENV_FILE" 2>/dev/null; then
    awk -v var="$var" -v val="$val" '
      BEGIN { done = 0 }
      $0 ~ "^"var"=" { if (!done) { print var"="val; done=1 } ; next }
      { print }
      END { if (!done) print var"="val }
    ' "$ENV_FILE" > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$var" "$val" >> "$ENV_FILE"
  fi
}

prompt_value() {
  # prompt_value VAR LABEL HINT [allow_empty]
  local var="$1"
  local label="$2"
  local hint="${3:-}"
  local allow_empty="${4:-false}"
  local current value mask

  current="$(current_value "$var")"
  mask=""
  if [ -n "$current" ]; then
    if [ "${#current}" -gt 12 ]; then
      mask="${current:0:8}…${current: -4}"
    else
      mask="$current"
    fi
  fi

  printf '\n%s→ %s%s\n' "$BOLD" "$label" "$RESET" >&2
  [ -n "$hint" ] && printf '  %s%s%s\n' "$DIM" "$hint" "$RESET" >&2
  if [ -n "$current" ]; then
    printf '  %scurrent: %s%s\n' "$GREY" "$mask" "$RESET" >&2
    printf '  %sPress %sEnter%s to keep, or paste new value: %s' "$CYAN" "$BOLD" "$RESET$CYAN" "$RESET" >&2
    IFS= read -r value
    [ -z "$value" ] && value="$current"
  else
    printf '  %sPaste value: %s' "$CYAN" "$RESET" >&2
    IFS= read -r value
  fi

  if [ -z "$value" ] && [ "$allow_empty" != "true" ]; then
    printf '%s× empty value — aborting%s\n' "$YELLOW" "$RESET" >&2
    exit 1
  fi

  set_env "$var" "$value"
  printf '%s' "$value"
}

# --- intro -------------------------------------------------------------------

cat <<EOF
${BOLD}=========================================================${RESET}
${BOLD}  Blank Collar — Stripe Checkout setup${RESET}
${BOLD}=========================================================${RESET}

This wires real payments — pricing cards in Settings → Billing,
Stripe Checkout sessions on Upgrade clicks, webhook-driven
subscription state, and tier gating on the agent count.

${BOLD}You'll need these from your Stripe dashboard${RESET}
(${CYAN}https://dashboard.stripe.com${RESET}, in ${YELLOW}TEST MODE${RESET}):

  ${YELLOW}1. Secret Key${RESET}
     Developers → API keys → ${BOLD}Secret key${RESET} (sk_test_…)
     Click ${BOLD}"Reveal test key"${RESET} first.

  ${YELLOW}2. Pro plan Price ID${RESET}
     Product catalogue → create a product called "Pro" at \$49/mo
     recurring → save → copy the ${BOLD}Price ID${RESET} (price_…).
     Add metadata: ${DIM}tier = pro${RESET}.

  ${YELLOW}3. Studio plan Price ID${RESET} (optional)
     Same idea — "Studio" at \$199/mo, metadata ${DIM}tier = studio${RESET}.

${BOLD}You'll also need the Stripe CLI for local webhook testing${RESET}:

  ${CYAN}brew install stripe/stripe-cli/stripe${RESET}
  ${CYAN}stripe login${RESET}
  ${CYAN}stripe listen --forward-to http://localhost:3001/api/webhooks/stripe${RESET}

  ${DIM}That last command prints a webhook signing secret (whsec_…)${RESET}
  ${DIM}— that's value #4 below. Keep that terminal open while testing.${RESET}

EOF

printf '%sReady to paste the values? [Y/n] %s' "$CYAN" "$RESET"
IFS= read -r ready
case "$ready" in n|N|no|NO) exit 0 ;; esac

# --- prompts -----------------------------------------------------------------

SECRET="$(prompt_value "STRIPE_SECRET_KEY" \
  "Stripe Secret Key" \
  "starts with sk_test_ in test mode (sk_live_ in production)")"

case "$SECRET" in
  sk_test_*|sk_live_*) ;;
  *)
    printf '%s⚠ that does not look like a Stripe secret key%s\n' "$YELLOW" "$RESET"
    printf '  expected: sk_test_… or sk_live_…  got: %s\n' "${SECRET:0:12}…"
    printf '  continue anyway? [y/N] '
    IFS= read -r ok
    case "$ok" in y|Y|yes|YES) ;; *) exit 1 ;; esac
    ;;
esac

PRO_ID="$(prompt_value "STRIPE_PRICE_ID_PRO" \
  "Pro tier Price ID" \
  "starts with price_ — copy from the product page in Stripe")"

case "$PRO_ID" in
  price_*) ;;
  *)
    printf '%s⚠ that does not look like a Stripe Price ID (price_…)%s\n' "$YELLOW" "$RESET"
    printf '  continue anyway? [y/N] '
    IFS= read -r ok
    case "$ok" in y|Y|yes|YES) ;; *) exit 1 ;; esac
    ;;
esac

prompt_value "STRIPE_PRICE_DISPLAY_PRO" \
  "Pro price label (cosmetic)" \
  "shown on the upgrade card, e.g. \$49 / mo" \
  true >/dev/null

STUDIO_ID="$(prompt_value "STRIPE_PRICE_ID_STUDIO" \
  "Studio tier Price ID (optional)" \
  "press Enter to skip — Studio plan won't appear in the UI" \
  true)"

if [ -n "$STUDIO_ID" ]; then
  case "$STUDIO_ID" in
    price_*) ;;
    *)
      printf '%s⚠ that does not look like a Stripe Price ID (price_…)%s\n' "$YELLOW" "$RESET"
      printf '  continue anyway? [y/N] '
      IFS= read -r ok
      case "$ok" in y|Y|yes|YES) ;; *) exit 1 ;; esac
      ;;
  esac
  prompt_value "STRIPE_PRICE_DISPLAY_STUDIO" \
    "Studio price label (cosmetic)" \
    "e.g. \$199 / mo" \
    true >/dev/null
fi

WEBHOOK="$(prompt_value "STRIPE_WEBHOOK_SECRET" \
  "Webhook signing secret" \
  "starts with whsec_ — from \`stripe listen\` output (or Stripe Dashboard → Webhooks → endpoint → signing secret)")"

case "$WEBHOOK" in
  whsec_*) ;;
  *)
    printf '%s⚠ that does not look like a Stripe webhook secret (whsec_…)%s\n' "$YELLOW" "$RESET"
    printf '  continue anyway? [y/N] '
    IFS= read -r ok
    case "$ok" in y|Y|yes|YES) ;; *) exit 1 ;; esac
    ;;
esac

# --- enforcement -------------------------------------------------------------

set_env "BLANKCOLLAR_BILLING_ENFORCE" "true"

# --- summary -----------------------------------------------------------------

if [ -n "$STUDIO_ID" ]; then
  STUDIO_LINE="    STRIPE_PRICE_ID_STUDIO       = ${STUDIO_ID}"
else
  STUDIO_LINE="    STRIPE_PRICE_ID_STUDIO       = (skipped — Studio plan won't appear in UI)"
fi

cat <<EOF

${GREEN}✓ Wrote values to .env:${RESET}
    STRIPE_SECRET_KEY            = ${SECRET:0:12}…
    STRIPE_PRICE_ID_PRO          = ${PRO_ID}
${STUDIO_LINE}
    STRIPE_WEBHOOK_SECRET        = ${WEBHOOK:0:12}…
    BLANKCOLLAR_BILLING_ENFORCE  = true

${BOLD}Next:${RESET} restart paperclip so it picks up the new env (no
website rebuild needed — these are server-side only).

EOF

printf '%sRestart paperclip now? [Y/n] %s' "$CYAN" "$RESET"
IFS= read -r ans
case "$ans" in
  n|N|no|NO)
    printf '\n%sSkipping restart. Run this when ready:%s\n' "$DIM" "$RESET"
    printf '  docker compose up -d paperclip\n\n'
    exit 0
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  printf '%s⚠ docker not on PATH — skipping restart.%s\n' "$YELLOW" "$RESET"
  exit 0
fi

printf '\n%sRestarting paperclip…%s\n' "$DIM" "$RESET"
docker compose up -d paperclip

cat <<EOF

${GREEN}✓ Paperclip restarted.${RESET}

${BOLD}Test the checkout flow:${RESET}

  1. Make sure ${CYAN}stripe listen --forward-to http://localhost:3001/api/webhooks/stripe${RESET}
     is running in another terminal.
  2. Open ${CYAN}http://localhost:3000${RESET} signed in as your test user.
  3. Sidebar → ${BOLD}Settings${RESET} → ${BOLD}Billing${RESET}.
  4. Click ${BOLD}Upgrade to Pro${RESET}. You'll redirect to Stripe Checkout.
  5. Use the Stripe test card:
       Number: ${BOLD}4242 4242 4242 4242${RESET}
       Expiry: any future date (e.g. 12/30)
       CVC:    any 3 digits
       ZIP:    any 5 digits
  6. Click ${BOLD}Subscribe${RESET}. Stripe processes, redirects you back.
  7. Watch the ${CYAN}stripe listen${RESET} terminal — you should see events:
       checkout.session.completed
       customer.subscription.created
  8. Refresh ${BOLD}Settings → Billing${RESET}. Should show ${BOLD}Pro · ACTIVE${RESET}.

${BOLD}Verify the row in postgres:${RESET}
  docker exec -it bc_postgres psql -U postgres blankcollar \\
    -c "SELECT tier, status, current_period_end FROM billing.subscription;"

${BOLD}Test the tier gate:${RESET}
  Try creating more than 3 agents on the free tier — POST /api/agents
  should return 402 with an upgrade hint.

EOF
