# Changelog

All notable changes to Blank Collar Agentic OS land here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely.

## [Unreleased]

### Phase 1 — Real Memory Layer (gbrain v0.1.0)

- New service: `packages/gbrain/` — Python 3.12 + FastAPI + pydantic v2 + asyncpg + qdrant-client
- Endpoints implemented per `docs/API.md`:
  - `GET /healthz` — service status, version, embedding model, embed provider
  - `POST /remember` — embed + store memory; metadata in Postgres, vector in Qdrant
  - `POST /recall` — role-scoped semantic search across memory kinds
  - `POST /forget` — delete memory + audit-log entry
- Embedding strategy: OpenAI `text-embedding-3-small` (1536d) by default; deterministic hash-based fake fallback when `OPENAI_API_KEY` is unset (service stays runnable offline; loud `WARNING` logs)
- Qdrant collections lazy-created on first write, named `{org_slug}__{kind}`, with payload indexes on `org_id`, `department_id`, `goal_id`, `visible_to`
- Role-scope filter (`app/scope.py`):
  - Always pins `org_id`
  - Department-scoped recalls also see org-wide memories (department_id IS NULL)
  - Goal-scoped recalls also see goal-less memories
  - `owner` and `auditor` read all memories in their org
  - `team_member` and `agent` are filtered by `visible_to`
- Audit-log integration: every `remember`/`forget` writes to `core.audit_log` with action, target, scope metadata
- 16 unit tests for the scope filter (the security-critical pure function)
- `docker-compose.yml`: gbrain placeholder replaced with a real `build:` directive (image `blankcollar/gbrain:0.1.0`)
- `infra/scripts/doctor.sh`: now hits `/healthz` and checks the gbrain container's healthcheck status
- `infra/scripts/bootstrap.sh`: waits for `bc_gbrain` to become healthy
- CI: new `gbrain` job runs `ruff check`, `pytest`, and `docker build`

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
