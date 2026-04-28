# Roadmap

A phased plan from groundwork to public launch. Each phase ends with something demoable.

## Phase 0 — Groundwork *(now)*

**Goal:** anyone can clone the repo and have the whole stack running on their Mac in under 5 minutes.

- [x] Monorepo scaffold (`apps/`, `packages/`, `infra/`, `docs/`)
- [x] `docker-compose.yml` with Postgres + Qdrant + 4 placeholder services
- [x] `init.sql` schema for `core`, `ops`, `brain`
- [x] `.env.example` covering current + future phases
- [x] `bootstrap.sh`, `doctor.sh`, `reset.sh`
- [x] README, ARCHITECTURE, GOAL_FIRST, ROLES, COMPANY_BRAIN, LOCAL_SETUP, QA_CHECKLIST
- [x] CI lint workflow

## Phase 1 — Real Memory Layer ✅

**Goal:** `gbrain` is no longer a placeholder; agents can `/remember` and `/recall`.

- [x] gbrain HTTP service (Python · FastAPI · pydantic v2 · asyncpg · qdrant-client)
- [x] Embedding pipeline (default `text-embedding-3-small`; deterministic fake fallback when no API key)
- [x] Qdrant collection bootstrap (one collection per `(org, kind)`, lazy-created)
- [x] Role-scoped recall queries (owner/auditor read-all; team_member/agent gated by `visible_to`)
- [x] Audit-log integration on remember/forget (writes to `core.audit_log`)
- [x] Unit tests for the scope filter (16 tests, the security-critical pure function)
- [x] Dockerfile + docker-compose integration; `doctor.sh` checks `/healthz`
- [x] CI job: ruff lint + pytest + image build
- [ ] CLI: `bc memory remember "fact" --dept=marketing` *(deferred to Phase 2 alongside Paperclip CLI)*

## Phase 2 — Paperclip Orchestrator

**Goal:** create goals via API; runs are dispatched (against fake agents) and visible.

- [ ] Paperclip HTTP API (goals, runs, agents, audit)
- [ ] Run queue (Postgres-backed in-memory queue is fine to start)
- [ ] Agent registry (`ops.agent`)
- [ ] Minimal dashboard at `/` listing goals + runs
- [ ] Websocket for live run telemetry

## Phase 3 — First Real Workforce

**Goal:** an end-to-end demo: create a goal → real Hermes agent does the work → result visible in dashboard.

- [ ] Hermes adapter (real container, `/run` contract)
- [ ] OpenClaw integration (real container)
- [ ] Skills minimal set (web fetch, file read, send email)
- [ ] Demo goal: "Summarize today's HN front page and email me"

## Phase 4 — Goal Command Centre

**Goal:** the dashboard becomes the *thing*. Goal-first UX, not API-first.

- [ ] Beautiful goal cards (status, blockers, next decision)
- [ ] Department views
- [ ] Plan review/approve flow
- [ ] Drill-down to runs and (only on demand) raw agent traces
- [ ] Mobile-friendly read view

## Phase 5 — Intelligence Layer

**Goal:** add new capabilities by configuration, not code.

- [ ] Skills catalog
- [ ] MCP tool registry
- [ ] Policy engine `(role, skill) → allow|approve|deny`
- [ ] Approval inbox for human-in-the-loop tools

## Phase 6 — Auth & Multi-Tenancy

**Goal:** more than one user, more than one org, real role enforcement.

- [ ] Supabase integration
- [ ] Org / department / user CRUD UI
- [ ] Invite flows
- [ ] Audit log explorer

## Phase 7 — Payments & Onboarding

**Goal:** a stranger lands on the marketing site and ends up running their own agent company.

- [ ] Stripe billing
- [ ] Onboarding wizard (paste your goals → we wire up the departments)
- [ ] `agent@blankcollar.ai` inbound email pipeline
- [ ] Hosted tier gated behind subscription

## Phase 8 — Public Launch

**Goal:** www.blankcollar.ai opens to the public.

- [ ] Marketing site
- [ ] Skill marketplace
- [ ] Templates ("Solo Creator OS", "Two-Person SaaS OS", "Agency OS")
- [ ] First 100 users
