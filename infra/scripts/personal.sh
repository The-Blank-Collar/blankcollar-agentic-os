#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — personal.sh
# Lands you in a single-user "personal assistant" world.
#
# What it does (idempotent):
#   1. Boots the stack if it's not already up (delegates to bootstrap.sh).
#   2. Creates (or reuses) a personal org with slug = $PERSONAL_ORG_SLUG.
#   3. Creates (or reuses) your user_account + owner role assignment.
#   4. Hires the default agent roster (Hermes / OpenClaw / LangGraph) into the
#      personal org if not already there.
#   5. Sets PAPERCLIP_DEFAULT_ORG_SLUG to the personal slug for this stack.
#
# Usage:
#   make personal NAME="Lior Avraham" EMAIL=lior@example.com
#   make personal              # uses sensible defaults
#
# Why a separate org from blankcollar-demo: the demo org is the multi-tenant
# scaffold (departments, demo data). The personal org is yours — single-user,
# no departments, role=owner, dept=NULL.
# -----------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
NAME=${NAME:-You}
EMAIL=${EMAIL:-you@blankcollar.local}
PERSONAL_ORG_SLUG=${PERSONAL_ORG_SLUG:-blankcollar-personal}
PERSONAL_ORG_NAME=${PERSONAL_ORG_NAME:-"Personal — $NAME"}

# 1. Stack up
if ! docker ps --format '{{.Names}}' | grep -qx 'bc_postgres'; then
  echo "▶ stack not running — bootstrapping…"
  "$ROOT_DIR/infra/scripts/bootstrap.sh"
fi

# 2 + 3. Org + user + role
read -r -d '' SQL_BOOTSTRAP <<'SQL_EOF' || true
WITH new_org AS (
  INSERT INTO core.organization (slug, name)
  VALUES (:'slug', :'org_name')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
),
upserted_user AS (
  INSERT INTO core.user_account (org_id, email, display_name, is_active)
  SELECT id, :'email', :'name', true FROM new_org
  ON CONFLICT (email) DO UPDATE
     SET is_active = true,
         display_name = COALESCE(EXCLUDED.display_name, core.user_account.display_name)
  RETURNING id
)
INSERT INTO core.role_assignment (user_id, department_id, role)
SELECT id, NULL, 'owner'::core.role_kind FROM upserted_user
ON CONFLICT (user_id, department_id, role) DO NOTHING;

SELECT o.id    AS org_id,
       o.slug  AS org_slug,
       u.id    AS user_id,
       u.email,
       u.display_name
  FROM core.organization o
  JOIN core.user_account u ON u.org_id = o.id
 WHERE o.slug = :'slug';
SQL_EOF

docker exec -i bc_postgres psql \
  -U postgres -d blankcollar \
  -v ON_ERROR_STOP=1 \
  -v "slug=$PERSONAL_ORG_SLUG" \
  -v "org_name=$PERSONAL_ORG_NAME" \
  -v "email=$EMAIL" \
  -v "name=$NAME" \
  -c "$SQL_BOOTSTRAP"

# 4. Hire the default agents in the personal org. Reuses Paperclip's bootstrap
#    by pointing it at the personal slug for one boot. The simplest way is to
#    just run a tiny SQL that mirrors ensureDefaultAgents().
read -r -d '' SQL_AGENTS <<'SQL_EOF' || true
WITH personal AS (
  SELECT id FROM core.organization WHERE slug = :'slug'
),
defaults (kind, name, description) AS (
  VALUES
    ('hermes',    'Hermes — General Reasoning',         'Reads memories, drafts, plans, decides.'),
    ('openclaw',  'OpenClaw — Web Actions',             'Fetches URLs, sends emails, browses with Playwright.'),
    ('langgraph', 'LangGraph — Multi-Agent Dispatcher', 'Classifies subtasks and routes to Hermes or OpenClaw.')
)
INSERT INTO ops.agent (org_id, kind, name, config, is_active)
SELECT (SELECT id FROM personal),
       d.kind,
       d.name,
       jsonb_build_object('description', d.description),
       true
  FROM defaults d
 WHERE NOT EXISTS (
   SELECT 1 FROM ops.agent
    WHERE org_id = (SELECT id FROM personal)
      AND kind   = d.kind
 );
SQL_EOF

docker exec -i bc_postgres psql \
  -U postgres -d blankcollar \
  -v ON_ERROR_STOP=1 \
  -v "slug=$PERSONAL_ORG_SLUG" \
  -c "$SQL_AGENTS" >/dev/null

# 4b. Seed the weekly self-audit + level-up routine. Fires Monday 9am UTC.
#     Closes the self-improvement loop without the operator having to wire it.
read -r -d '' SQL_SELF_AUDIT <<'SQL_EOF' || true
WITH personal AS (
  SELECT id FROM core.organization WHERE slug = :'slug'
),
audit_goal AS (
  INSERT INTO ops.goal (org_id, title, description, kind, cron_expr, status, metadata)
  SELECT id,
         'Weekly self-audit',
         'Every Monday at 09:00 UTC: run the self.audit skill on the last 7 days,'
         || E'\n' || 'then propose changes via self.level_up.',
         'routine'::ops.goal_kind,
         '0 9 * * 1',
         'active'::ops.goal_status,
         jsonb_build_object('source', 'personal-bootstrap', 'invokes_skill', 'self.audit')
    FROM personal
   WHERE NOT EXISTS (
     SELECT 1 FROM ops.goal
      WHERE org_id = (SELECT id FROM personal)
        AND title = 'Weekly self-audit'
        AND kind = 'routine'
   )
   RETURNING id
)
SELECT id AS audit_goal_id FROM audit_goal;
SQL_EOF

docker exec -i bc_postgres psql \
  -U postgres -d blankcollar \
  -v ON_ERROR_STOP=1 \
  -v "slug=$PERSONAL_ORG_SLUG" \
  -c "$SQL_SELF_AUDIT" >/dev/null

# 5. Tell Paperclip which org to default to. Persist the slug in .env so it
#    survives restarts and reboots, then recreate paperclip. Running compose
#    from the repo root (no -f) honours COMPOSE_FILE in .env, so the prod /
#    personal overlays keep applying on the restart.
echo "▶ pointing Paperclip at $PERSONAL_ORG_SLUG…"
ENV_FILE="$ROOT_DIR/.env"
if grep -qE "^PAPERCLIP_DEFAULT_ORG_SLUG=" "$ENV_FILE" 2>/dev/null; then
  awk -v val="$PERSONAL_ORG_SLUG" '
    BEGIN { done = 0 }
    /^PAPERCLIP_DEFAULT_ORG_SLUG=/ { if (!done) { print "PAPERCLIP_DEFAULT_ORG_SLUG=" val; done = 1 }; next }
    { print }
  ' "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
else
  printf '\nPAPERCLIP_DEFAULT_ORG_SLUG=%s\n' "$PERSONAL_ORG_SLUG" >> "$ENV_FILE"
fi
(cd "$ROOT_DIR" && docker compose stop paperclip >/dev/null 2>&1 || true)
(cd "$ROOT_DIR" && docker compose up -d paperclip)

cat <<EOF

✅ Personal mode ready.

   org    : $PERSONAL_ORG_SLUG
   you    : $NAME <$EMAIL>
   agents : Hermes, OpenClaw, LangGraph (idle, waiting on you)
   routine: Weekly self-audit (Mon 09:00 UTC)

Next:
   open http://localhost:\${PAPERCLIP_PORT:-3000}/
   curl -s http://localhost:\${PAPERCLIP_PORT:-3000}/api/briefing/today | jq

To go back to the multi-tenant demo:
   set PAPERCLIP_DEFAULT_ORG_SLUG=blankcollar-demo in .env, then:
   docker compose up -d paperclip
EOF
