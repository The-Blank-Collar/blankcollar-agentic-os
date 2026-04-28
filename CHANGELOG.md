# Changelog

All notable changes to Blank Collar Agentic OS land here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely.

## [Unreleased]

### Phase 0 — Groundwork

- Initial monorepo scaffold (`apps/`, `packages/`, `infra/`, `docs/`, `.github/`)
- `docker-compose.yml` with Postgres 16, Qdrant v1.12, and four nginx-served placeholders for Paperclip, Hermes, OpenClaw, gbrain
- Optional `pgadmin` profile for Postgres GUI
- `infra/docker/postgres/init.sql` — schemas `core`, `ops`, `brain`; seed demo organization with five departments
- `infra/scripts/bootstrap.sh`, `doctor.sh`, `reset.sh`
- `.env.example` covering Phase 0 variables and placeholders for Supabase, Stripe, and inbound email
- Docs: README, ARCHITECTURE, GOAL_FIRST, ROLES, COMPANY_BRAIN, LOCAL_SETUP, QA_CHECKLIST, ROADMAP
- CI: docker-compose validation, shellcheck, env-var coverage, init.sql smoke test
