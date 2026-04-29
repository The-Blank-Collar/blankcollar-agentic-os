#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — restore.sh
#
# Restores a tarball produced by `backup.sh`. DESTRUCTIVE — replaces the
# current Postgres databases, Qdrant volume, and Neo4j volume on this host.
#
# Usage:
#   ./infra/scripts/restore.sh <path/to/blankcollar-<TS>.tar.gz>
#   FORCE=1 ./infra/scripts/restore.sh <tarball>      # skip confirmation
#
# Components are restored independently — if a component is missing from
# the tarball (e.g. Neo4j was skipped at backup time) the script logs a
# warning and moves on.
#
# After restore: bring the stack back with `make up && make doctor`.
# -----------------------------------------------------------------------------
set -euo pipefail

if [ "$#" -lt 1 ]; then
    echo "usage: $0 <path/to/backup.tar.gz>" >&2
    exit 2
fi

TARBALL="$1"
[ -f "$TARBALL" ] || { echo "✗ no such file: $TARBALL" >&2; exit 1; }

# Source .env (best effort) for credentials / db names.
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
fi

PG_USER="${POSTGRES_USER:-postgres}"
PG_DB="${POSTGRES_DB:-blankcollar}"
NANGO_USER="${NANGO_DB_USER:-nango}"
NANGO_DB="${NANGO_DB_NAME:-nango}"

echo "── Blank Collar restore ───────────────────────────────────────────────"
echo "  source: $TARBALL"
echo
echo "This will OVERWRITE on this host:"
echo "  - Postgres database '$PG_DB' (bc_postgres)"
echo "  - Postgres database '$NANGO_DB' (bc_nango_db) — Nango OAuth tokens"
echo "  - Volume bc_qdrant_data"
echo "  - Volume bc_neo4j_data"
echo

if [ "${FORCE:-0}" != "1" ]; then
    printf 'Type "RESTORE" to continue, anything else to abort: '
    read -r answer
    if [ "$answer" != "RESTORE" ]; then
        echo "aborted." >&2
        exit 1
    fi
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$TARBALL" -C "$WORK"

if [ -f "$WORK/MANIFEST.txt" ]; then
    echo
    echo "── manifest ────"
    cat "$WORK/MANIFEST.txt"
    echo "────────────────"
    echo
fi

# ----- Postgres (main) ------------------------------------------------------
if [ -f "$WORK/postgres.dump" ]; then
    echo "→ pg_restore bc_postgres ($PG_DB)"
    docker inspect bc_postgres >/dev/null 2>&1 || { echo "✗ bc_postgres not running" >&2; exit 1; }
    docker exec -i bc_postgres psql -U "$PG_USER" -d postgres -c "DROP DATABASE IF EXISTS $PG_DB WITH (FORCE);" >/dev/null
    docker exec -i bc_postgres psql -U "$PG_USER" -d postgres -c "CREATE DATABASE $PG_DB OWNER $PG_USER;" >/dev/null
    docker exec -i bc_postgres pg_restore -U "$PG_USER" -d "$PG_DB" --no-owner --no-privileges < "$WORK/postgres.dump"
    echo "  ok"
else
    echo "! no postgres.dump in tarball — skipped"
fi

# ----- Postgres (Nango) -----------------------------------------------------
if [ -f "$WORK/nango_db.dump" ]; then
    echo "→ pg_restore bc_nango_db ($NANGO_DB)"
    docker inspect bc_nango_db >/dev/null 2>&1 || { echo "✗ bc_nango_db not running" >&2; exit 1; }
    docker exec -i bc_nango_db psql -U "$NANGO_USER" -d postgres -c "DROP DATABASE IF EXISTS $NANGO_DB WITH (FORCE);" >/dev/null
    docker exec -i bc_nango_db psql -U "$NANGO_USER" -d postgres -c "CREATE DATABASE $NANGO_DB OWNER $NANGO_USER;" >/dev/null
    docker exec -i bc_nango_db pg_restore -U "$NANGO_USER" -d "$NANGO_DB" --no-owner --no-privileges < "$WORK/nango_db.dump"
    echo "  ok"
else
    echo "! no nango_db.dump in tarball — skipped"
fi

# ----- Qdrant volume --------------------------------------------------------
if [ -f "$WORK/qdrant_data.tar.gz" ]; then
    echo "→ restore bc_qdrant_data (brief stop)"
    docker inspect bc_qdrant >/dev/null 2>&1 && docker stop bc_qdrant >/dev/null || true
    docker run --rm \
        -v bc_qdrant_data:/dest \
        -v "$WORK":/src \
        alpine sh -c "rm -rf /dest/* /dest/.[!.]* 2>/dev/null; tar -xzf /src/qdrant_data.tar.gz -C /dest" >/dev/null
    docker inspect bc_qdrant >/dev/null 2>&1 && docker start bc_qdrant >/dev/null || true
    echo "  ok"
else
    echo "! no qdrant_data.tar.gz in tarball — skipped"
fi

# ----- Neo4j volume ---------------------------------------------------------
if [ -f "$WORK/neo4j_data.tar.gz" ]; then
    echo "→ restore bc_neo4j_data (brief stop)"
    docker inspect bc_neo4j >/dev/null 2>&1 && docker stop bc_neo4j >/dev/null || true
    docker run --rm \
        -v bc_neo4j_data:/dest \
        -v "$WORK":/src \
        alpine sh -c "rm -rf /dest/* /dest/.[!.]* 2>/dev/null; tar -xzf /src/neo4j_data.tar.gz -C /dest" >/dev/null
    docker inspect bc_neo4j >/dev/null 2>&1 && docker start bc_neo4j >/dev/null || true
    echo "  ok"
else
    echo "! no neo4j_data.tar.gz in tarball — skipped"
fi

# ----- Brand files ----------------------------------------------------------
if [ -d "$WORK/brand" ]; then
    echo "→ brand/ — skipping (never overwritten by restore; in git)."
    echo "  if you need it, copy by hand: cp -R $WORK/brand/* ./brand/"
fi

echo
echo "✓ restore complete."
echo
echo "Next:"
echo "  make doctor       # confirm the stack is healthy"
echo "  make psql         # spot-check that data is back"
