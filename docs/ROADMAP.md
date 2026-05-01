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

## Phase 2 — Paperclip Orchestrator ✅

**Goal:** create goals via API; runs are dispatched (against fake agents) and visible.

- [x] Paperclip HTTP API (goals, runs, agents, audit, plan/dispatch) — `docs/API.md`
- [x] Run queue (Postgres-backed `FOR UPDATE SKIP LOCKED`, in-process worker)
- [x] Agent registry CRUD (`ops.agent`) — hire / update / fire endpoints
- [x] Goal-first dashboard at `/` — server-rendered, htmx-driven
- [x] Built-in fake agent that writes an `episode` memory to gbrain (proves L1↔L4 wiring)
- [x] Audit-log entries on every state change
- [x] Vitest tests, typecheck, Docker image, CI job
- [ ] WebSocket for live run telemetry *(deferred to Phase 3 — polling works for v0)*

## Phase 3 — First Real Workforce ✅

**Goal:** an end-to-end demo: create a goal → real agent does the work → result visible in dashboard.

- [x] Hermes adapter (real Python/FastAPI container, full adapter contract)
- [x] OpenClaw integration (real Python/FastAPI container, full adapter contract)
- [x] Adapter HTTP client + registry on Paperclip (`http://hermes:80`, `http://openclaw:80`)
- [x] In-process fake-agent retired; worker now polls real adapters until terminal
- [x] Default Hermes + OpenClaw rows auto-inserted into `ops.agent` on Paperclip startup
- [x] Plan generator recognises URLs in goals → fetch → summarise → decision
- [x] "Run plan" button dispatches all subtasks at once
- [x] Skills (v0): `web.fetch` (politeness controls + IP-literal safety)
- [x] Demo goal works: *"Summarize https://news.ycombinator.com/ for me."*
- [ ] Email send skill *(deferred to Phase 5 alongside the policy engine)*
- [ ] WebSocket telemetry *(deferred — polling is sufficient for v0)*

## Phase 3.5 — Backend Tightening (single-user first) ✅ in progress

**Goal:** lock the API contract before the React console handoff. Soften the goal-first language without breaking the goal-first model.

- [x] `ops.goal` gets a `kind` enum (`ephemeral` | `standing` | `routine` | `decision`)
- [x] `ops.goal` first-class columns: `cron_expr`, `due_at`, `progress`, `target_value`, `actual_value`, `delta_label`, `track_state`
- [x] `ops.key_result` table + CRUD routes; embedded in `GET /api/goals/:id`
- [x] `ops.goal_contributor` table (humans + agents per goal)
- [x] `ops.briefing` table + `/api/briefing/today`, `/api/briefing/generate` (templated v0)
- [x] `ops.capture` table + `POST /api/capture` (the user's verb) with heuristic classifier
- [x] Idempotent additive migrations apply on every Paperclip boot
- [x] `GET /api/inbox` — decisions / blocked / drafts feed, urgency-ordered
- [x] `GET /api/heartbeat` — 14-day system pulse (captures, runs, goals, activity)
- [x] `GET /api/agents/:id/state` — live / idle / warn + current activity + sigil seed
- [x] `POST /api/goals/:id/resolve` — approve/decline a decision goal
- [x] `GET /api/brain/graph` — synthesised nodes + edges for the constellation page
- [x] Hermes-narrated briefings (Anthropic-direct, brand voice, templated fallback)
- [x] In-process routine scheduler — fires `kind=routine` goals on `cron_expr`
- [x] `make personal` — single-user bootstrap with personal org + default agents
- [x] Email-ingest service activated — IMAP poller writes conversation memories + POSTs actionable mail to `/api/capture`
- [x] RLS policies on `ops.*`, `brain.memory`, `core.audit_log` — bound to session GUC `app.org_id` via `withOrgScope()`. Permissive default until routes migrate.
- [x] Scheduled daily briefing — auto-fires once per UTC day at `PAPERCLIP_BRIEFING_HOUR_UTC` per active org
- [x] Inbox `routine_output` distinct from `draft` — UI can render "your Monday digest is ready" vs generic drafts
- [x] Inbox dismissal — `POST /api/inbox/acknowledge/:goal_id` marks runs seen so items stop surfacing
- [x] **Four Cs extension** — Skills Engine, Routines Engine (event/api triggers), Onboarding interview, Self-Improvement (Audit + Level-Up), Knowledge wiki, Google Workspace connectors (see `docs/INTEGRATION_PLAN.md`)
- [x] Approval queue — `ops.approval` + `/api/approvals/*` + surface in inbox; agent ↔ human pause-and-decide protocol
- [x] Webhook capture intake — `POST /api/webhooks/capture` HMAC-verified; arbitrary externals drop into the capture pipeline
- [x] Channels presence — `GET /api/channels` over Nango connections + sentinel rows for email and webhook
- [x] Hermes-driven capture classifier — LLM call when `ANTHROPIC_API_KEY` set, heuristic stays as fallback
- [x] Brain graph TTL cache (30s) + `/api/health` enrichment (probes hermes/openclaw/workspace + counts)
- [x] **`bc` CLI** — `packages/cli/`: terminal-side wrapper for every endpoint, editorial output for humans + JSON for pipes (`make cli`)
- [ ] Migrate every route to `withOrgScope()` and flip RLS unset branch to NONE — mechanical pass across ~14 handlers; one bounded session
- [ ] Hermes-driven capture classifier (replaces v0 heuristic for nuanced parsing)
- [ ] Migrate every route to `withOrgScope()` and flip RLS default to NONE (unset = block)

## Phase 4 — Goal Command Centre

**Goal:** the dashboard becomes the *thing*. Goal-first UX, not API-first. The console replaces Paperclip's htmx UI; built against the Phase-3.5 contract.

- [ ] Vite + React console at `apps/website/` (Swiss editorial, dark-first)
- [ ] Capture-first input ("what's on your mind") instead of "create a goal"
- [ ] Daily briefing as the front door (replaces the goals list as default)
- [ ] Goal cards differentiated by `kind` (decision card / routine card / standing card)
- [ ] Drill-down to runs and (only on demand) raw agent traces
- [ ] Mobile-friendly read view (deferred until desktop ships)

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
