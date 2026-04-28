#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — user-add.sh
# Provisions a user in core.user_account + core.role_assignment for the demo
# org, so a Supabase-issued JWT for this email can resolve to a real scope.
#
# Usage (typically via the Makefile):
#   make user-add EMAIL=alice@example.com
#   make user-add EMAIL=alice@example.com ROLE=team_member NAME="Alice"
#
# ROLE defaults to `owner`. Valid values:
#   owner | department_lead | team_member | auditor | agent
# -----------------------------------------------------------------------------
set -euo pipefail

EMAIL=${EMAIL:-}
ROLE=${ROLE:-owner}
NAME=${NAME:-}

if [ -z "$EMAIL" ]; then
  echo "usage: EMAIL=alice@example.com [ROLE=owner] [NAME='Alice'] $0" >&2
  exit 2
fi

case "$ROLE" in
  owner|department_lead|team_member|auditor|agent) ;;
  *) echo "invalid ROLE='$ROLE' (expected: owner | department_lead | team_member | auditor | agent)" >&2; exit 2 ;;
esac

if ! docker ps --format '{{.Names}}' | grep -qx 'bc_postgres'; then
  echo "❌ bc_postgres is not running. Start the stack first: make bootstrap" >&2
  exit 1
fi

read -r -d '' SQL <<'SQL_EOF' || true
WITH demo_org AS (
  SELECT id FROM core.organization WHERE slug = 'blankcollar-demo' LIMIT 1
),
upserted AS (
  INSERT INTO core.user_account (org_id, email, display_name, is_active)
  SELECT (SELECT id FROM demo_org), :'email', NULLIF(:'name', ''), true
  ON CONFLICT (email) DO UPDATE
     SET is_active = true,
         display_name = COALESCE(EXCLUDED.display_name, core.user_account.display_name)
  RETURNING id, org_id
)
INSERT INTO core.role_assignment (user_id, department_id, role)
SELECT id, NULL, :'role'::core.role_kind FROM upserted
ON CONFLICT (user_id, department_id, role) DO NOTHING;

SELECT u.id AS user_id,
       u.email,
       u.display_name,
       string_agg(ra.role::text, ',') AS roles
  FROM core.user_account u
  LEFT JOIN core.role_assignment ra ON ra.user_id = u.id
 WHERE u.email = :'email'
 GROUP BY u.id;
SQL_EOF

docker exec -i bc_postgres psql \
  -U postgres -d blankcollar \
  -v ON_ERROR_STOP=1 \
  -v "email=$EMAIL" \
  -v "role=$ROLE" \
  -v "name=$NAME" \
  -c "$SQL"

echo "✅ provisioned $EMAIL with role=$ROLE in the demo org"
