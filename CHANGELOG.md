# Changelog

All notable changes to Blank Collar Agentic OS land here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely.

## [Unreleased]

### Phase 0 — Groundwork

#### Stack & infra
- Initial monorepo scaffold (`apps/`, `packages/`, `infra/`, `docs/`, `.github/`, `templates/`)
- `docker-compose.yml` with Postgres 16, Qdrant v1.12, and four nginx-served placeholders for Paperclip, Hermes, OpenClaw, gbrain
- Optional `pgadmin` profile for Postgres GUI
- `infra/docker/postgres/init.sql` — schemas `core`, `ops`, `brain`; seed demo organization with five departments
- `infra/scripts/bootstrap.sh`, `doctor.sh`, `reset.sh` — one-command local ops
- `Makefile` — ergonomic wrappers (`make up / down / doctor / psql / logs / reset`)
- `.env.example` covering Phase 0 variables and placeholders for Supabase, Stripe, and inbound email
- `.dockerignore`, `.gitattributes`, `.editorconfig` — build hygiene & line-ending discipline

#### Placeholder app/package folders (groundwork for future phases)
- `apps/paperclip` — orchestrator + dashboard (real in Phase 2)
- `apps/hermes` — Hermes adapter (real in Phase 3)
- `apps/openclaw` — OpenClaw agent (real in Phase 3)
- `apps/website` — www.blankcollar.ai marketing surface (Phase 8)
- `apps/billing` — Stripe billing service (Phase 7)
- `apps/auth` — Supabase auth & role mapping (Phase 6)
- `apps/email-ingest` — `agent@blankcollar.ai` inbound pipeline (Phase 7)
- `packages/gbrain` — memory layer service (Phase 1)
- `packages/skills` — L2 intelligence layer registry (Phase 5)
- `packages/agents` — shared adapter types & helpers (Phase 3)
- `packages/shared` — cross-package reserved space

#### Templates
- `templates/goals/` — five starting-point goal templates:
  - `marketing-newsletter-growth`
  - `support-inbox-triage`
  - `sales-outbound-leads`
  - `finance-monthly-close`
  - `content-weekly-engine`

#### Documentation
- Vision & positioning: `VISION`, `BRAND`, `GLOSSARY`, `FAQ`, `USE_CASES`, `COMPARISON`, `MARKETING`
- Architecture & contracts: `ARCHITECTURE`, `GOAL_FIRST`, `ROLES`, `COMPANY_BRAIN`, `AGENTS`, `SKILLS`, `API`, `SCHEMA`, `INTEGRATIONS`, `ENVIRONMENT`
- Operations: `LOCAL_SETUP`, `ONBOARDING`, `QA_CHECKLIST`, `TESTING`, `OBSERVABILITY`, `DEPLOYMENT`, `BACKUP_RESTORE`, `ROADMAP`
- Working agreement: `README`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`, `CLAUDE.md`

#### GitHub
- CI: docker-compose validation, shellcheck, env-var coverage, init.sql smoke test
- Templates: PR template, bug report, feature request, question
- `CODEOWNERS`, `FUNDING.yml`, `dependabot.yml`, `release.yml`, `labels.yml`, `ISSUE_TEMPLATE/config.yml`
