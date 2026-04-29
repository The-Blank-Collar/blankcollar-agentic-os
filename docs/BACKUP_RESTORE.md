# Backup & Restore

How to keep your Company Brain alive across machine moves, accidents, and Docker tantrums.

## TL;DR — the script

```bash
make backup                                          # produces ./backups/blankcollar-<TS>.tar.gz
make restore TARBALL=./backups/blankcollar-<TS>.tar.gz   # destructive; prompts you to type RESTORE
```

`make backup` runs `./infra/scripts/backup.sh`, which captures everything
that can't be rebuilt from git in one tarball:

- `bc_postgres` → `pg_dump -Fc` (online, no downtime)
- `bc_nango_db` → `pg_dump -Fc` (online; OAuth tokens live here)
- `bc_qdrant_data` → volume tar (briefly stops `bc_qdrant`, ~5s)
- `bc_neo4j_data` → volume tar (briefly stops `bc_neo4j`, ~10s)
- `brand/` → copy (in case the file was edited live on the VPS)

A `MANIFEST.txt` at the top of the tarball records timestamp + git SHA +
component sizes.

`make restore TARBALL=…` requires you to literally type `RESTORE` to
proceed (or set `FORCE=1`), then drops + recreates each Postgres
database, untars the Qdrant + Neo4j volumes, and runs each restore step
independently — a missing component logs a warning instead of aborting.

After restore: `make doctor` should still exit 0.

## What's worth backing up?

| Volume                  | What's in it                                | Replaceable?                       |
|-------------------------|---------------------------------------------|------------------------------------|
| `bc_postgres_data`      | All structured state (goals, runs, memory metadata, audit log) | **No.** Back up. |
| `bc_nango_db_data`      | OAuth tokens + Nango integration config     | **No.** Back up. Re-doing every OAuth dance is the worst. |
| `bc_qdrant_data`        | All vectors & their payloads                | Re-embeddable from Postgres if you saved `content`. Slow & costly. **Back up.** |
| `bc_neo4j_data`         | Graphiti's temporal graph                   | Rebuildable from gbrain memories via the bridge. Back up to skip the rebuild. |
| `bc_pgadmin_data`       | pgAdmin UI config                           | Yes. Don't bother.                  |
| `.env`                  | Secrets, ports                              | Yes — but back it up if you set strong passwords. |
| `brand/`                | Brand Foundation file(s)                    | Yes (in git), but a live edit on the VPS would be lost. The script captures it.|

## Simple offline snapshot (Phase 0–1)

Stop the stack, snapshot the volumes, restart.

```bash
make down

# 1. Postgres
docker run --rm \
  -v bc_postgres_data:/data \
  -v "$PWD/backups":/out alpine \
  tar czf /out/pg-$(date +%F).tar.gz -C /data .

# 2. Qdrant
docker run --rm \
  -v bc_qdrant_data:/data \
  -v "$PWD/backups":/out alpine \
  tar czf /out/qdrant-$(date +%F).tar.gz -C /data .

make up
```

The tarballs are self-contained. Move them to wherever you keep backups.

## Live SQL dump (no downtime)

Better for incremental backups while the stack is running:

```bash
docker exec bc_postgres pg_dump -U postgres -Fc blankcollar \
  > backups/blankcollar-$(date +%F-%H%M).dump
```

`-Fc` produces a compressed custom-format dump that `pg_restore` can replay onto any 16+ Postgres.

For Qdrant, use its built-in snapshot API (Phase 1+ once we wire it):

```bash
curl -X POST "http://localhost:6333/snapshots"
curl -O "http://localhost:6333/snapshots/<snapshot-name>"
```

## Restore — full

From offline tarballs:

```bash
# from a clean machine, with this repo cloned and Docker running
docker volume create bc_postgres_data
docker volume create bc_qdrant_data

docker run --rm \
  -v bc_postgres_data:/data \
  -v "$PWD/backups":/in alpine \
  sh -c "cd /data && tar xzf /in/pg-2026-04-28.tar.gz"

docker run --rm \
  -v bc_qdrant_data:/data \
  -v "$PWD/backups":/in alpine \
  sh -c "cd /data && tar xzf /in/qdrant-2026-04-28.tar.gz"

make up
make doctor
```

From a SQL dump:

```bash
make up
docker exec -i bc_postgres pg_restore -U postgres -d blankcollar --clean --if-exists \
  < backups/blankcollar-2026-04-28.dump
```

## Restore — Postgres only (Brain rebuilt)

If you lost Qdrant but kept Postgres (the `brain.memory.content` is the source of truth):

```bash
# 1. restore Postgres as above
# 2. when gbrain ships in Phase 1, run:
make brain-rebuild
# which iterates brain.memory rows, re-embeds each, writes to Qdrant
```

`brain-rebuild` will be idempotent — safe to run twice.

## Cross-machine move

1. On the old machine: `make down`, snapshot both volumes, copy tarballs to the new machine.
2. On the new machine: clone the repo, copy `.env`, restore both volumes, `make up`, `make doctor`.

## What backups don't cover

- **External SaaS state** (Stripe customers, Supabase users when they exist): those are sources of truth in their own systems — restore them via their own tools.
- **Inbound emails in flight**: if an email arrived during the moment between backup and disaster, it's gone. Use the inbound provider's replay mechanism.
- **In-memory queue items** (Phase 2+): runs that were in `queued` state will be re-queued on startup; `running` runs at the moment of crash will be marked `failed` and require dispatch again.

## Backup hygiene

- **Test restores** at least once per phase. A backup you've never restored is a guess.
- **Offsite**. Keep at least one copy off the same machine.
- **Encrypt** if your backups leave the machine. `gpg --symmetric` is enough for personal use.
- **Retention**: 7 daily + 4 weekly + 6 monthly is plenty for self-hosters.
