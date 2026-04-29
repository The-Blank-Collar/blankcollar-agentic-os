#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — backup.sh
#
# Captures everything that can't be rebuilt from git:
#
#   - bc_postgres   : pg_dump (online, no downtime)
#   - bc_nango_db   : pg_dump (online, no downtime) — OAuth tokens live here
#   - bc_qdrant     : volume tar (brief stop ~5s) — vectors
#   - bc_neo4j      : volume tar (brief stop ~10s) — graphiti's graph
#   - brand/        : copied as-is in case the file was edited live on the VPS
#
# Output: one timestamped tarball, default ./backups/blankcollar-<TS>.tar.gz.
# Scp it home, push it to S3, whatever.
#
# Usage:
#   ./infra/scripts/backup.sh                            # all components
#   BACKUP_DIR=/srv/backups ./infra/scripts/backup.sh    # custom output dir
#   SKIP_QDRANT=1 ./infra/scripts/backup.sh              # skip Qdrant volume
#   SKIP_NEO4J=1 ./infra/scripts/backup.sh               # skip Neo4j volume
#
# Notes:
# - `pg_dump -Fc` produces a compressed custom-format dump that pg_restore
#   can use later. Smallest format that doesn't need a flat .sql.
# - Qdrant + Neo4j stop briefly because their on-disk state isn't safe to
#   tar while the process is writing. A few seconds of downtime each.
# - The script is idempotent: rerun it any time.
# -----------------------------------------------------------------------------
set -euo pipefail

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT_DIR="${BACKUP_DIR:-./backups}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Source .env (best effort) so POSTGRES_USER / NANGO_DB_USER overrides apply.
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

mkdir -p "$OUT_DIR"
mkdir -p "$WORK/components"

echo "── Blank Collar backup ────────────────────────────────────────────────"
echo "  output : $OUT_DIR/blankcollar-$TS.tar.gz"
echo "  work   : $WORK"
echo

# ----- Postgres (main) -------------------------------------------------------
if docker inspect bc_postgres >/dev/null 2>&1; then
    echo "→ pg_dump bc_postgres ($PG_DB)"
    docker exec bc_postgres pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$WORK/components/postgres.dump"
    echo "  $(stat -c%s "$WORK/components/postgres.dump" 2>/dev/null || stat -f%z "$WORK/components/postgres.dump") bytes"
else
    echo "! bc_postgres not running — skipping main Postgres dump"
fi

# ----- Postgres (Nango) ------------------------------------------------------
if docker inspect bc_nango_db >/dev/null 2>&1; then
    echo "→ pg_dump bc_nango_db ($NANGO_DB)"
    docker exec bc_nango_db pg_dump -U "$NANGO_USER" -Fc "$NANGO_DB" > "$WORK/components/nango_db.dump"
    echo "  $(stat -c%s "$WORK/components/nango_db.dump" 2>/dev/null || stat -f%z "$WORK/components/nango_db.dump") bytes"
else
    echo "! bc_nango_db not running — skipping Nango Postgres dump"
fi

# ----- Qdrant volume tar -----------------------------------------------------
if [ "${SKIP_QDRANT:-0}" != "1" ] && docker volume inspect bc_qdrant_data >/dev/null 2>&1; then
    echo "→ qdrant volume tar (brief stop)"
    QDRANT_RUNNING=0
    docker inspect bc_qdrant >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Running}}' bc_qdrant 2>/dev/null)" = "true" ] && QDRANT_RUNNING=1
    [ "$QDRANT_RUNNING" = "1" ] && docker stop bc_qdrant >/dev/null
    docker run --rm \
        -v bc_qdrant_data:/source:ro \
        -v "$WORK/components":/dest \
        alpine tar -czf /dest/qdrant_data.tar.gz -C /source . >/dev/null
    [ "$QDRANT_RUNNING" = "1" ] && docker start bc_qdrant >/dev/null
    echo "  $(stat -c%s "$WORK/components/qdrant_data.tar.gz" 2>/dev/null || stat -f%z "$WORK/components/qdrant_data.tar.gz") bytes"
else
    echo "! skipping Qdrant volume (SKIP_QDRANT=1 or volume missing)"
fi

# ----- Neo4j volume tar ------------------------------------------------------
if [ "${SKIP_NEO4J:-0}" != "1" ] && docker volume inspect bc_neo4j_data >/dev/null 2>&1; then
    echo "→ neo4j volume tar (brief stop)"
    NEO4J_RUNNING=0
    docker inspect bc_neo4j >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Running}}' bc_neo4j 2>/dev/null)" = "true" ] && NEO4J_RUNNING=1
    [ "$NEO4J_RUNNING" = "1" ] && docker stop bc_neo4j >/dev/null
    docker run --rm \
        -v bc_neo4j_data:/source:ro \
        -v "$WORK/components":/dest \
        alpine tar -czf /dest/neo4j_data.tar.gz -C /source . >/dev/null
    [ "$NEO4J_RUNNING" = "1" ] && docker start bc_neo4j >/dev/null
    echo "  $(stat -c%s "$WORK/components/neo4j_data.tar.gz" 2>/dev/null || stat -f%z "$WORK/components/neo4j_data.tar.gz") bytes"
else
    echo "! skipping Neo4j volume (SKIP_NEO4J=1 or volume missing)"
fi

# ----- Brand files -----------------------------------------------------------
if [ -d brand ]; then
    echo "→ brand/"
    cp -R brand "$WORK/components/brand"
fi

# ----- Manifest --------------------------------------------------------------
{
    echo "blankcollar-backup"
    echo "timestamp=$TS"
    echo "host=$(hostname)"
    echo "git_sha=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo "components:"
    for f in "$WORK/components"/*; do
        [ -e "$f" ] || continue
        size=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f")
        echo "  - $(basename "$f") $size"
    done
} > "$WORK/components/MANIFEST.txt"

# ----- Bundle ---------------------------------------------------------------
TARBALL="$OUT_DIR/blankcollar-$TS.tar.gz"
tar -czf "$TARBALL" -C "$WORK/components" .
SIZE=$(stat -c%s "$TARBALL" 2>/dev/null || stat -f%z "$TARBALL")

echo
echo "✓ backup written: $TARBALL ($SIZE bytes)"
echo
echo "  scp to your laptop:"
echo "    scp ${USER}@<vps>:$(realpath "$TARBALL") ~/backups/"
echo
echo "  restore later:"
echo "    ./infra/scripts/restore.sh $TARBALL"
