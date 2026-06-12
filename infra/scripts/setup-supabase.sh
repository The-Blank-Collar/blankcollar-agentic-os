#!/usr/bin/env bash
#
# setup-supabase.sh — interactive Supabase auth wiring (Phase 8.1).
#
# Walks the operator through pasting the 3 values they copied from the
# Supabase dashboard, writes them into .env (preserving everything else),
# turns on PAPERCLIP_AUTH_ENFORCE, and offers to rebuild the website +
# paperclip containers so the new env takes effect.
#
# Usage:
#     make setup-supabase
#     # or directly:
#     ./infra/scripts/setup-supabase.sh
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

# --- helpers -----------------------------------------------------------------

current_value() {
  # Print the current value of $1 in .env (or empty).
  local var="$1"
  awk -F= -v var="$var" '
    $1 == var { sub(/^[^=]*=/, ""); print; exit }
  ' "$ENV_FILE"
}

set_env() {
  # Upsert KEY=VAL in .env, preserving everything else.
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
  # prompt_value VAR LABEL HINT
  # All interactive output goes to stderr so callers can use $(...)
  # to capture only the value on stdout.
  local var="$1"
  local label="$2"
  local hint="${3:-}"
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

  set_env "$var" "$value"
  printf '%s' "$value"
}

# --- intro -------------------------------------------------------------------

cat <<EOF
${BOLD}=========================================================${RESET}
${BOLD}  Blank Collar — Supabase auth setup${RESET}
${BOLD}=========================================================${RESET}

This wires real auth so signups create real per-user orgs.

You'll need 2 values from your Supabase dashboard
(${CYAN}https://supabase.com/dashboard${RESET}):

  ${YELLOW}1. Project URL${RESET}
     Settings (gear icon, bottom-left) → General → "Reference ID"
     becomes the URL: https://<reference>.supabase.co
     (or copy from the project home page)

  ${YELLOW}2. Legacy anon key${RESET}
     Settings → API Keys → click ${BOLD}"Legacy anon, service_role
     API keys"${RESET} tab → copy the ${BOLD}anon public${RESET} row
     (long string starting with ${DIM}eyJhbGc…${RESET})

That's it. The JWT verification keys are fetched automatically from
your project URL (modern Supabase asymmetric signing). If your project
still uses the legacy HS256 secret, you can paste it as an optional
fallback at the end.

Existing values in .env are shown — press Enter to keep them.

EOF

# --- prompts -----------------------------------------------------------------

URL="$(prompt_value "SUPABASE_URL" \
  "Supabase Project URL" \
  "e.g. https://abc123xyz.supabase.co — must start with https:// and end .supabase.co")"

# Validate format.
case "$URL" in
  https://*.supabase.co|https://*.supabase.in)
    ;;
  "")
    printf '%s× empty URL — aborting%s\n' "$YELLOW" "$RESET"; exit 1 ;;
  *)
    printf '%s⚠ that URL does not look like a Supabase project URL%s\n' "$YELLOW" "$RESET"
    printf '  expected: https://<id>.supabase.co  got: %s\n' "$URL"
    printf '  continue anyway? [y/N] '
    IFS= read -r ok
    case "$ok" in y|Y|yes|YES) ;; *) exit 1 ;; esac
    ;;
esac

# Mirror to the Vite-side var so the website build picks it up.
set_env "VITE_SUPABASE_URL" "$URL"

ANON="$(prompt_value "VITE_SUPABASE_ANON_KEY" \
  "Legacy anon public key" \
  "starts with eyJhbGc — paste the WHOLE thing, no quotes")"

if [ -z "$ANON" ]; then
  printf '%s× empty anon key — aborting%s\n' "$YELLOW" "$RESET"; exit 1
fi
case "$ANON" in
  eyJ*) ;;
  sb_publishable_*)
    printf '%s⚠ that is the NEW publishable key (sb_publishable_…)%s\n' "$YELLOW" "$RESET"
    printf '  Our backend currently verifies the LEGACY HS256 anon key.\n'
    printf '  Go back to the Supabase dashboard, click the\n'
    printf '  "Legacy anon, service_role API keys" tab, and paste the\n'
    printf '  long eyJhbGc… key from there.\n'
    printf '  continue anyway? [y/N] '
    IFS= read -r ok
    case "$ok" in y|Y|yes|YES) ;; *) exit 1 ;; esac
    ;;
  *)
    printf '%s⚠ that does not look like a Supabase anon key%s\n' "$YELLOW" "$RESET"
    printf '  continue anyway? [y/N] '
    IFS= read -r ok
    case "$ok" in y|Y|yes|YES) ;; *) exit 1 ;; esac
    ;;
esac

JWT="$(prompt_value "SUPABASE_JWT_SECRET" \
  "JWT Secret (optional)" \
  "OPTIONAL — leave blank if your project uses asymmetric signing (default for new projects). Only paste if Settings → JWT Keys → Legacy JWT Secret tab shows a value you want as fallback.")"

if [ -n "$JWT" ] && [ "${#JWT}" -lt 32 ]; then
  printf '%s⚠ JWT secret looks short (%d chars). Real ones are typically 64+%s\n' "$YELLOW" "${#JWT}" "$RESET"
  printf '  continue anyway? [y/N] '
  IFS= read -r ok
  case "$ok" in y|Y|yes|YES) ;; *) exit 1 ;; esac
fi

# --- enforcement flags -------------------------------------------------------

set_env "PAPERCLIP_AUTH_ENFORCE" "true"
set_env "PAPERCLIP_AUTO_BOOTSTRAP" "true"

# --- summary -----------------------------------------------------------------

if [ -n "$JWT" ]; then
  JWT_LINE="    SUPABASE_JWT_SECRET          = ${JWT:0:8}…${JWT: -4} (HS256 fallback)"
else
  JWT_LINE="    SUPABASE_JWT_SECRET          = (empty — using JWKS at ${URL}/auth/v1/.well-known/jwks.json)"
fi

cat <<EOF

${GREEN}✓ Wrote values to .env:${RESET}
    SUPABASE_URL                 = ${URL}
${JWT_LINE}
    VITE_SUPABASE_URL            = ${URL}
    VITE_SUPABASE_ANON_KEY       = ${ANON:0:12}…
    PAPERCLIP_AUTH_ENFORCE       = true
    PAPERCLIP_AUTO_BOOTSTRAP     = true

${BOLD}Next:${RESET} rebuild the website + paperclip so they pick up the new env.

EOF

printf '%sRebuild now? [Y/n] %s' "$CYAN" "$RESET"
IFS= read -r ans
case "$ans" in
  n|N|no|NO)
    printf '\n%sSkipping rebuild. Run this when ready:%s\n' "$DIM" "$RESET"
    printf '  docker compose up -d --build website paperclip\n\n'
    exit 0
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  printf '%s⚠ docker not on PATH — skipping rebuild.%s\n' "$YELLOW" "$RESET"
  exit 0
fi

printf '\n%sRebuilding website + paperclip…%s\n' "$DIM" "$RESET"
docker compose up -d --build website paperclip

cat <<EOF

${GREEN}✓ Rebuild complete.${RESET}

Test it:
  1. Open ${CYAN}http://localhost:3000${RESET} in a fresh incognito window.
  2. You should see the ${BOLD}Sign in / Create your studio${RESET} screen.
  3. Click ${BOLD}Create account${RESET} → fill in name, email, password.
  4. You should land on the dashboard, onboarding wizard pops open.

Verify the row in postgres:
  docker exec -it bc_postgres psql -U postgres blankcollar \\
    -c "SELECT email, full_name, org_id FROM core.user_account ORDER BY created_at DESC LIMIT 3;"

When this works → run ${BOLD}make setup-stripe${RESET} for the payments side.

EOF
