#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# infra/scripts/setup-keys.sh
# Interactive helper that prompts for each API key one at a time and writes it
# straight to .env.
#
# Safety properties:
#   - Values are read with `read -rs` → not echoed to your terminal, never
#     enter shell history.
#   - The value is passed via shell variable to a printf that writes a temp
#     file. It is never put on argv (which would be visible in `ps`) and
#     never logged.
#   - Hit Enter on an empty input to SKIP — the existing value is preserved.
#   - The .env file is replaced atomically (write to temp, then mv).
#
# Usage:
#   ./infra/scripts/setup-keys.sh
#   make setup-keys
# -----------------------------------------------------------------------------
set -euo pipefail

ENV_FILE="${ENV_FILE:-$(dirname "$0")/../../.env}"
ENV_FILE="$(realpath "$ENV_FILE" 2>/dev/null || readlink -f "$ENV_FILE" 2>/dev/null || echo "$ENV_FILE")"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ $ENV_FILE not found." >&2
  echo "  Run: cp .env.example .env" >&2
  exit 1
fi

# Each entry: KEY|description|required|hint
KEYS=(
  "PORTKEY_API_KEY|Portkey API key (starts pk-...)|required|https://app.portkey.ai/api-keys"
  "PORTKEY_VIRTUAL_KEY_ANTHROPIC|Portkey virtual key → Anthropic|required|app.portkey.ai → Virtual Keys → + Add → Anthropic"
  "PORTKEY_VIRTUAL_KEY_OPENROUTER|Portkey virtual key → OpenRouter|optional|app.portkey.ai → Virtual Keys → + Add → OpenRouter"
  "ANTHROPIC_API_KEY|Direct Anthropic key (sk-ant-...) — used by graphiti|optional|https://console.anthropic.com/"
  "OPENAI_API_KEY|OpenAI key (sk-...) — used by graphiti + gbrain embeddings|optional|https://platform.openai.com/api-keys"
  "INBOUND_CAPTURE_WEBHOOK_SECRET|Webhook capture HMAC shared secret|optional|generate any random 32+ chars (openssl rand -hex 32)"
  "NANGO_SECRET_KEY|Nango secret key (Workspace OAuth gateway)|optional|https://app.nango.dev/"
  "SUPABASE_JWT_SECRET|Supabase JWT secret (Phase 6 prep)|optional|Supabase project → API → JWT Secret"
)

# Replace (or append) `KEY=value` in $ENV_FILE atomically.
write_key() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)" || { echo "✗ mktemp failed" >&2; return 1; }
  # Inherit perms from .env so we don't accidentally world-read after rewrite.
  chmod --reference="$ENV_FILE" "$tmp" 2>/dev/null || chmod 600 "$tmp"

  local found=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "${key}="* ]]; then
      printf '%s=%s\n' "$key" "$value" >> "$tmp"
      found=1
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$ENV_FILE"

  if [[ "$found" -eq 0 ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi

  mv "$tmp" "$ENV_FILE"
}

current_value() {
  grep "^${1}=" "$ENV_FILE" 2>/dev/null | head -1 | sed 's/^[^=]*=//'
}

mask_state() {
  local cur="$1"
  if [[ -n "$cur" ]]; then
    echo "(currently set, ${#cur} chars)"
  else
    echo "(empty)"
  fi
}

cat <<EOF
Setting up API keys → $ENV_FILE
Hit Enter (empty input) to SKIP a key. Your input is hidden as you type.
Existing values are preserved on skip; entering a new value overwrites.

EOF

for entry in "${KEYS[@]}"; do
  IFS='|' read -r key label req hint <<< "$entry"

  current="$(current_value "$key")"
  state="$(mask_state "$current")"

  printf '─── %s\n' "$label"
  printf '    [%s] %s\n' "$req" "$state"
  printf '    hint: %s\n' "$hint"
  printf '    %s = ' "$key"

  # -r: don't process backslashes. -s: silent (no echo).
  IFS= read -rs value || value=""
  echo  # newline after the hidden read

  if [[ -z "$value" ]]; then
    echo "    → skipped"
  else
    write_key "$key" "$value"
    echo "    → saved (${#value} chars written)"
  fi

  # Wipe the local variable so subsequent iterations don't carry it.
  value=""
  echo
done

cat <<EOF
✓ done.

Verify which keys are set (without revealing the values):
  grep -E '^(PORTKEY|ANTHROPIC|OPENAI|NANGO|SUPABASE|INBOUND)_' '$ENV_FILE' \\
    | sed 's/=.*/=<set>/' \\
    | grep -v '=<set>$' || echo "    (all configured keys above have a value)"

When you're ready: make up
EOF
