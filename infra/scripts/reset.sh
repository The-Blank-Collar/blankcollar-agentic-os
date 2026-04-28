#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — reset.sh
# Interactive: stop the stack and wipe local volumes (Postgres, Qdrant, pgAdmin).
# -----------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

cat <<'EOF'
This will:
  1. docker compose down
  2. delete the local Docker volumes:
       - bc_postgres_data   (Postgres data)
       - bc_qdrant_data     (Qdrant data)
       - bc_pgadmin_data    (pgAdmin settings)

You will lose every local goal, run, memory, and any seeded data.
This does NOT affect any remote / hosted environments.

EOF

read -r -p "Type 'reset' to confirm: " confirm
if [ "$confirm" != "reset" ]; then
  echo "Aborted."
  exit 1
fi

docker compose down -v --remove-orphans
# Belt & braces — remove named volumes if they survived (rare, but possible if compose was renamed)
for v in bc_postgres_data bc_qdrant_data bc_pgadmin_data; do
  docker volume rm "$v" >/dev/null 2>&1 || true
done

echo "✅ Reset complete. Run ./infra/scripts/bootstrap.sh to start fresh."
