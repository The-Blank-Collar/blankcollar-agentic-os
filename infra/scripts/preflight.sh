#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — preflight.sh
#
# Run BEFORE `./infra/scripts/deploy.sh` on the production VPS. Refuses to
# pass if the .env still carries any local-only defaults that would be
# disastrous in prod (default Nango encryption key, default auth secret,
# default dashboard password, etc.) or if a required public-facing var
# is unset.
#
# Exits 0 only if the environment is genuinely production-ready.
#
# Usage:
#   ./infra/scripts/preflight.sh           # checks .env in cwd
#   ENV_FILE=/path/to/.env ./infra/scripts/preflight.sh
# -----------------------------------------------------------------------------
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"

if [ ! -f "$ENV_FILE" ]; then
    echo "✗ no $ENV_FILE found — copy from .env.example and edit" >&2
    exit 1
fi

# Pull a value from .env. Strips quotes and trailing comments.
get() {
    local key="$1"
    local val
    val=$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 | sed -E "s/^${key}=//; s/^['\"]//; s/['\"]$//")
    printf '%s' "$val"
}

FAIL=0
WARN=0

fail() {
    echo "✗ $1" >&2
    FAIL=$((FAIL + 1))
}
warn() {
    echo "! $1"
    WARN=$((WARN + 1))
}
ok() {
    echo "✓ $1"
}

echo "── Blank Collar preflight ─────────────────────────────────────────────"
echo "  env file: $ENV_FILE"
echo

# -----------------------------------------------------------------------------
# 1. Defaults that MUST be replaced before going public.
# -----------------------------------------------------------------------------
echo "[1/5] no-default-secrets"

if [ "$(get NANGO_ENCRYPTION_KEY)" = "RZwOryJRG/8AvoR6yeqrh4QkgZUQOK+2" ]; then
    fail "NANGO_ENCRYPTION_KEY is the placeholder. Generate a new one: openssl rand -base64 32"
else
    ok "NANGO_ENCRYPTION_KEY rotated"
fi

if [ "$(get PAPERCLIP_AUTH_SECRET)" = "replace-me-with-a-32-byte-hex-string" ] || [ -z "$(get PAPERCLIP_AUTH_SECRET)" ]; then
    fail "PAPERCLIP_AUTH_SECRET is unset or placeholder. Generate: openssl rand -hex 32"
else
    ok "PAPERCLIP_AUTH_SECRET set"
fi

if [ "$(get NANGO_DASHBOARD_PASSWORD)" = "admin" ]; then
    fail "NANGO_DASHBOARD_PASSWORD is 'admin'. Pick a real one before exposing the UI subdomain."
else
    ok "NANGO_DASHBOARD_PASSWORD non-default"
fi

if [ "$(get POSTGRES_PASSWORD)" = "postgres" ]; then
    warn "POSTGRES_PASSWORD is 'postgres' — fine for a single-tenant locked-down VPS, dangerous if ever exposed."
else
    ok "POSTGRES_PASSWORD non-default"
fi

if [ "$(get NEO4J_PASSWORD)" = "password" ]; then
    warn "NEO4J_PASSWORD is 'password' — fine if 7474/7687 stay bound to 127.0.0.1 (prod overlay does this)."
else
    ok "NEO4J_PASSWORD non-default"
fi

if [ "$(get QDRANT_API_KEY)" = "" ]; then
    warn "QDRANT_API_KEY empty — fine if 6333 stays bound to 127.0.0.1 (prod overlay does this)."
else
    ok "QDRANT_API_KEY set"
fi

# -----------------------------------------------------------------------------
# 2. Required public-facing vars
# -----------------------------------------------------------------------------
echo
echo "[2/5] public-facing vars"

for v in PUBLIC_DOMAIN NANGO_PUBLIC_DOMAIN NANGO_UI_DOMAIN ACME_EMAIL; do
    val=$(get "$v")
    if [ -z "$val" ]; then
        fail "$v is unset"
    else
        ok "$v=$val"
    fi
done

# -----------------------------------------------------------------------------
# 3. Auth + billing wiring
# -----------------------------------------------------------------------------
echo
echo "[3/5] auth + billing wiring"

if [ -z "$(get SUPABASE_JWT_SECRET)" ]; then
    warn "SUPABASE_JWT_SECRET unset — every API call resolves to the demo org's owner. Set this once Supabase is wired."
else
    ok "SUPABASE_JWT_SECRET set"
    if [ "$(get PAPERCLIP_AUTH_ENFORCE)" != "true" ]; then
        warn "SUPABASE_JWT_SECRET is set but PAPERCLIP_AUTH_ENFORCE=$(get PAPERCLIP_AUTH_ENFORCE). Flip to 'true' to require JWT on every call."
    else
        ok "PAPERCLIP_AUTH_ENFORCE=true"
    fi
fi

if [ -z "$(get STRIPE_WEBHOOK_SECRET)" ]; then
    warn "STRIPE_WEBHOOK_SECRET unset — POST /api/webhooks/stripe will return 503 in prod."
else
    ok "STRIPE_WEBHOOK_SECRET set"
fi

# -----------------------------------------------------------------------------
# 4. Required-on-disk files
# -----------------------------------------------------------------------------
echo
echo "[4/5] on-disk files"

brand_name="$(get BRAND_NAME)"
brand_name="${brand_name:-blankcollar}"
if [ -f "brand/${brand_name}.md" ]; then
    ok "brand/${brand_name}.md present"
else
    fail "brand/${brand_name}.md missing — Hermes will run without a brand block."
fi

for f in docker-compose.yml docker-compose.prod.yml infra/caddy/Caddyfile; do
    if [ -f "$f" ]; then
        ok "$f present"
    else
        fail "$f missing"
    fi
done

# -----------------------------------------------------------------------------
# 5. Compose validation
# -----------------------------------------------------------------------------
echo
echo "[5/5] compose validation"

if docker compose -f docker-compose.yml -f docker-compose.prod.yml config -q 2>preflight.err; then
    ok "docker compose -f base -f prod config -q  → ok"
    rm -f preflight.err
else
    fail "docker compose config -q failed:"
    sed 's/^/    /' preflight.err >&2 || true
    rm -f preflight.err
fi

# Per-service env coverage: every ${VAR} in compose appears in .env.example or .env.
missing=$(comm -23 \
    <(grep -hoE '\$\{[A-Z_][A-Z0-9_]*' docker-compose.yml docker-compose.prod.yml 2>/dev/null | sed 's/^\${//' | sort -u) \
    <(grep -hoE '^[A-Z_][A-Z0-9_]*=' .env.example "$ENV_FILE" 2>/dev/null | sed 's/=$//' | sort -u))
if [ -z "$missing" ]; then
    ok "every \${VAR} in compose has a matching env entry"
else
    fail "compose vars missing from env:"
    printf '    %s\n' $missing >&2
fi

# -----------------------------------------------------------------------------
# Verdict
# -----------------------------------------------------------------------------
echo
echo "──────────────────────────────────────────────────────────────────────"
if [ "$FAIL" -gt 0 ]; then
    echo "✗ preflight FAILED with $FAIL hard error(s) and $WARN warning(s)" >&2
    exit 1
fi
if [ "$WARN" -gt 0 ]; then
    echo "✓ preflight OK with $WARN warning(s) — review above before deploy"
else
    echo "✓ preflight OK — clean"
fi
exit 0
