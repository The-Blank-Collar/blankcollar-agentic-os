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

# 5. Tell Paperclip which org to default to. Restarts paperclip with the new
#    PAPERCLIP_DEFAULT_ORG_SLUG so resolveCallerScope() returns this org.
echo "▶ pointing Paperclip at $PERSONAL_ORG_SLUG…"
docker compose -f "$ROOT_DIR/docker-compose.yml" stop paperclip >/dev/null 2>&1 || true
PAPERCLIP_DEFAULT_ORG_SLUG="$PERSONAL_ORG_SLUG" \
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d paperclip

cat <<EOF

✅ Personal mode ready.

   org    : $PERSONAL_ORG_SLUG
   you    : $NAME <$EMAIL>
   agents : Hermes, OpenClaw, LangGraph (idle, waiting on you)

Next:
   open http://localhost:\${PAPERCLIP_PORT:-3000}/
   curl -s http://localhost:\${PAPERCLIP_PORT:-3000}/api/briefing/today | jq

To go back to the multi-tenant demo:
   PAPERCLIP_DEFAULT_ORG_SLUG=blankcollar-demo docker compose up -d paperclip
EOF
