# Deployment

Blank Collar is **local-first by design**. Self-hosting on a single Mac is the supported "production" today. This page captures how we'll evolve from there.

## The two deploy targets

| Target              | Audience                          | Status   |
|---------------------|-----------------------------------|----------|
| **Local self-host** | Builders, power users, privacy-first | Supported today |
| **Hosted (SaaS)**   | Beginners, teams, anyone           | Phase 7+ |

Self-hosting will always remain a first-class option. The hosted product is the same code with a managed control plane, billing, and shared infrastructure.

## Local self-host

The supported "production" mode for Phase 0–6:

```bash
git clone https://github.com/The-Blank-Collar/blankcollar-agentic-os.git
cd blankcollar-agentic-os
cp .env.example .env
# edit .env — set strong POSTGRES_PASSWORD, generate PAPERCLIP_AUTH_SECRET, set QDRANT_API_KEY if non-localhost
make bootstrap
```

To survive reboots:

- Use the included `restart: unless-stopped` policy (already in `docker-compose.yml`).
- Pin to a release tag instead of tracking `main` once releases start (Phase 2+).
- Snapshot the Docker volumes regularly (see `BACKUP_RESTORE.md`).

### "Production-ish" hardening checklist for self-hosters

- [ ] Change `POSTGRES_PASSWORD` to a random 32+ char string.
- [ ] Generate `PAPERCLIP_AUTH_SECRET` with `openssl rand -hex 32`.
- [ ] Set `QDRANT_API_KEY` if Qdrant's port is reachable from outside `localhost`.
- [ ] Bind only the ports you actually need to the host.
- [ ] Put a TLS-terminating reverse proxy (Caddy / Traefik) in front of `paperclip` if you expose it.
- [ ] Pin image versions; don't use `latest`.
- [ ] Set up volume snapshots (`infra/scripts/backup.sh` once `BACKUP_RESTORE.md` ships).

## Hosted (Phase 7+)

The shape we're building toward:

```
                    ┌──────────────────────┐
                    │  www.blankcollar.ai  │  ← marketing & sign-in
                    └──────────┬───────────┘
                               │
                ┌──────────────▼──────────────┐
                │       Edge / CDN            │
                └──────────────┬──────────────┘
                               │ JWT
                ┌──────────────▼──────────────┐
                │  Paperclip (multi-tenant)   │  ← one cluster, many orgs
                └──┬──────┬──────┬─────────┬──┘
                   │      │      │         │
              ┌────▼─┐ ┌──▼──┐ ┌─▼────┐ ┌──▼──────┐
              │Hermes│ │Open │ │gbrain│ │ Skills/ │
              │ pool │ │Claw │ │      │ │  MCP    │
              └──────┘ └─────┘ └──┬───┘ └─────────┘
                                  │
                          ┌───────▼───────┐
                          │ Postgres + Qd │  ← per-org isolation via scope
                          └───────────────┘
```

**Tenancy:**
- Single Postgres cluster, **strict** scoping by `org_id` everywhere — never trust the app alone, also enforce row-level security.
- Single Qdrant deployment, one collection set per org (`{org_slug}__{kind}`).
- gbrain runs as a stateless service; it gets the scope from the JWT-validated request.

**Auth & billing:**
- Supabase JWTs, validated at the Paperclip edge.
- Stripe subscriptions gate org-level entitlement (max agents, max runs/day, etc.).

**Resource limits per org (initial):**
- N concurrent runs
- $X/mo soft cap with hard kill at 1.5×
- Embedding throughput cap

These are tuned by tier. Free tier exists; the goal is to never let an autonomous loop nuke a free user's wallet.

## What we'll deliberately *not* do (early)

- **Kubernetes from day one.** Compose-on-a-VM is fine until > 100 active orgs.
- **Microservices for the sake of it.** The L0–L4 boundaries are real; everything else can be a single binary until proven otherwise.
- **Custom infra.** Use managed Postgres, managed Qdrant, managed Supabase wherever it saves engineer-hours.

## Releases

Phase 2+ will adopt SemVer-tagged releases:

- `vMAJOR.MINOR.PATCH` git tags.
- A GitHub Release per tag with auto-categorized notes (`.github/release.yml`).
- Self-hosters pin a tag in their compose file:
  ```yaml
  image: ghcr.io/the-blank-collar/paperclip:v1.4.0
  ```
- Docker images published to GHCR by a `release.yml` workflow.

## Backups & disaster recovery

See [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md). Until that doc ships in Phase 2:

- Self-hosters: `docker run --rm -v bc_postgres_data:/data -v "$PWD":/backup alpine tar czf /backup/pg-$(date +%F).tar.gz /data` for an offline snapshot.
- Hosted: managed Postgres PITR, daily Qdrant snapshots, monthly DR test.
