# Changelog

All notable changes to Blank Collar Agentic OS land here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely.

## [Unreleased]

### Hostinger production readiness

- **Nexos.ai** (`apps/hermes/app/llm.py`): preferred LLM provider via the
  OpenAI-compatible Chat Completions endpoint at `https://api.nexos.ai/v1`.
  Anthropic stays as a fallback; FakeLLM keeps offline runs working.
- **Oxylabs AI Studio** (`apps/openclaw/app/search.py`): new `web.search`
  skill with provider-agnostic result normalisation. DuckDuckGo Instant
  Answer fallback when no Oxylabs key.
- **Email pipeline for `agent@blankcollar.ai`**:
  - Outbound: `email.send` skill in OpenClaw via `aiosmtplib` (drafted-mode
    when SMTP is unset).
  - Inbound: new `apps/email-ingest/` Python service that polls IMAP
    every minute and converts new mail into `conversation` memories +
    draft goals.
- **Supabase auth scaffolding**: HS256 JWT verification middleware in
  Paperclip (`apps/paperclip/src/auth.ts`); verify-when-present today,
  flip `PAPERCLIP_AUTH_ENFORCE=true` to require tokens.
- **Stripe webhook receiver**: HMAC verification + idempotent
  `billing.stripe_event` log + audit (`apps/paperclip/src/stripe.ts`,
  `apps/paperclip/src/routes/webhooks.ts`).
- **Hostinger deploy bundle**:
  - `docker-compose.prod.yml` — production overlay; only Caddy is
    publicly bound, all other services on `127.0.0.1` internal.
  - `infra/caddy/Caddyfile` — reverse proxy + auto-TLS via Let's Encrypt.
  - `infra/scripts/deploy.sh` — pull/build/up against `local` or `user@host`.
  - `docs/HOSTINGER_DEPLOY.md` — end-to-end walkthrough from VPS provisioning
    through DNS, hardening, env config, smoke test, Stripe + Supabase
    activation, backups, and a production sanity checklist.

### Phase 3 — First Real Workforce (Hermes + OpenClaw v0.1.0; Paperclip 0.2.0)

- **Hermes** (`apps/hermes/`) — Python 3.12 / FastAPI / `anthropic` SDK
  - Implements the Agent Adapter Contract: `/run` → 202, `/run/{id}`, cancel, `/healthz`
  - Reasoning loop: `gbrain /recall` → LLM call → `gbrain /remember` (episode)
  - Default model `claude-sonnet-4-6`; falls back to deterministic FakeLLM when `ANTHROPIC_API_KEY` is unset
  - 3 unit tests (succeed-path, cancel, idempotent state map)
- **OpenClaw** (`apps/openclaw/`) — Python 3.12 / FastAPI / httpx / selectolax
  - Same adapter contract
  - Skill: `web.fetch` — politeness (timeout, max-bytes, declared UA), refuses non-http(s) schemes and IP literals on private/loopback/link-local/reserved (incl. AWS IMDS)
  - Successful fetches write a `document` memory to gbrain
  - 9 unit tests (URL safety + HTML extraction)
- **Paperclip** integration (`apps/paperclip/`)
  - New `src/queue/adapter-client.ts` and `src/queue/registry.ts` (kind → URL)
  - `src/queue/worker.ts` rewritten: dispatch to real adapter, poll until terminal, mirror state into `ops.run`, write audit on succeeded/failed/cancelled
  - In-process fake agent removed
  - `src/bootstrap.ts`: idempotent default-agent hire on startup (Hermes + OpenClaw rows in `ops.agent`)
  - `src/plan.ts`: subtasks now carry `agent_kind`; URL-bearing goals auto-produce a fetch → summarise → decision plan
  - New `POST /api/goals/{id}/dispatch-all` endpoint (queues every subtask in one tx)
  - Dashboard: per-subtask kind pill; "Run plan" button on goal detail
  - 4 new plan tests (URL-aware planning); total 17/17 green
- Compose: Hermes + OpenClaw placeholders → real `build:` directives; agents depend on `gbrain` healthcheck; paperclip depends on agents
- `.env.example`: `HERMES_URL`, `OPENCLAW_URL`, `HERMES_MODEL`, `HERMES_MAX_TOKENS`, `HERMES_MAX_RECALL`, `OPENCLAW_FETCH_TIMEOUT_S`, `OPENCLAW_FETCH_MAX_BYTES`, `OPENCLAW_USER_AGENT`, `OPENCLAW_TEXT_EXCERPT_CHARS`
- `bootstrap.sh` waits for `bc_hermes` and `bc_openclaw`; `doctor.sh` hits `/healthz` on both
- CI: new `hermes` and `openclaw` jobs (ruff + pytest + image build)

### Phase 2 — Paperclip Orchestrator (v0.1.0)

- New service: `apps/paperclip/` — Node 22 + Fastify 5 + pg + Zod (TypeScript, ESM)
- HTTP API matching `docs/API.md`:
  - `GET /api/health` — Postgres + gbrain probes
  - Goals: `POST/GET/PATCH/DELETE /api/goals`, `GET /api/goals/{id}`
  - Plan + dispatch: `POST /api/goals/{id}/plan`, `POST /api/goals/{id}/dispatch`
  - Runs: `GET /api/runs`, `GET /api/runs/{id}`, `POST /api/runs/{id}/cancel`
  - Agents: `GET/POST /api/agents`, `PATCH /api/agents/{id}` (hire/update/fire)
  - Audit: `GET /api/audit`
- Server-rendered, htmx-driven dashboard at `/`:
  - Goals list with create form, status pills, auto-refresh every 4s
  - Goal detail page with plan, dispatch buttons, runs auto-refreshing every 2s
- In-process queue worker:
  - Polls `ops.run` with `FOR UPDATE SKIP LOCKED` (safe for future scale-out)
  - Dispatches `queued → running → succeeded/failed` with audit entries on each
  - Configurable poll interval, can be disabled with `PAPERCLIP_WORKER_ENABLED=false`
- Built-in **fake agent** (until Phase 3 brings real Hermes / OpenClaw):
  - Writes an `episode` memory to gbrain on success — proves the L1↔L4 wiring
- Audit-log integration: every goal create/update/archive, plan, dispatch, run state change, and agent change writes to `core.audit_log`
- Caller-scope stub: hardcoded to the demo org's `owner` (Phase 6 will swap in Supabase JWT)
- 13 unit tests (plan + schema validation), all passing
- Multi-stage Node 22 Dockerfile (deps → build → prod-deps → runtime), non-root, healthcheck
- `docker-compose.yml`: nginx placeholder replaced with build directive (image `blankcollar/paperclip:0.1.0`)
- `bootstrap.sh`: waits for `bc_paperclip` healthy
- `doctor.sh`: hits `/api/health` instead of `/`
- `.env.example`: `PAPERCLIP_DEFAULT_ORG_SLUG`, `PAPERCLIP_WORKER_POLL_MS`, `PAPERCLIP_WORKER_ENABLED`, `GBRAIN_URL`
- CI: new `paperclip` job runs `tsc --noEmit`, `vitest`, and `docker build`

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
