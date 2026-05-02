# Blank Collar — Status

> **The single-page "what's actually built" doc.**
> Last updated: end of Phase 2 close-out (commit `f0116ec`).

This file is the source of truth for "what does Blank Collar look like today?" Every other doc — ROADMAP, ARCHITECTURE, the per-feature docs in `docs/` — explains the *how* or the *why*. This one is the inventory.

---

## TL;DR

Blank Collar is a **local-first, goal-first agentic OS**. You declare an outcome ("send Mira an apology by Friday"), the system orchestrates agents + skills + tools to deliver it. Every action is audited. Every LLM call is observable. Every tool can be simulated before it fires for real.

**Phase 2 (local-first development) is complete.** Phase 3 (cloud migration) and Phase 4 (React UI) are next. The system runs end-to-end on a laptop with `make bootstrap`.

| | |
|---|---|
| Status | Phase 2 complete · Phase 3/4 not started |
| Source files | ~6 100 (TypeScript + Python + YAML + SQL) |
| Tests | **270 passing** (193 paperclip + 31 CLI + 24 hermes + 17 langgraph + 5 graphiti) |
| Test files | 198 |
| Docs | 38 markdown files in `docs/` |
| API routes | 29 route files in `apps/paperclip/src/routes/` |
| CLI commands | 49 dispatch cases in `bc help` |
| Database tables | ~30 in `core` / `ops` / `brain` schemas |
| Owner | Kristian Kabashi · [@theblankcollar](https://github.com/theblankcollar) |
| License | MIT |

---

## Architecture at a glance

```
              ┌──────────────────────────────┐
              │   Operator (you)             │
              │   bc CLI · htmx dashboard    │
              └─────────────┬────────────────┘
                            │ HTTP
              ┌─────────────▼────────────────┐
              │   Paperclip (TypeScript)     │  Fastify · port 3000
              │   • 29 route files           │  goals · runs · skills · tools
              │   • Worker (run dispatcher)  │  documents · upstream · payments
              │   • Scheduler (cron + tick)  │  policy engine · feedback
              │   • Policy + simulation      │
              └──┬──────┬───────┬──────┬─────┘
                 │      │       │      │
        ┌────────▼─┐  ┌─▼────┐ ┌▼────┐│
        │ Hermes   │  │Open- │ │Lang-││
        │ reasoning│  │claw  │ │graph││  Python · FastAPI agents
        │ (Python) │  │tools │ │disp.││  Each speaks the adapter contract.
        └──────────┘  └──────┘ └─────┘│
                                      │
              ┌───────────────────────▼─────┐
              │ Portkey AI gateway          │  Single chokepoint for every LLM call.
              │ (anthropic / openrouter VKs)│  Cost + latency observability.
              └─────────────────────────────┘

              ┌──────────────┐  ┌────────────┐  ┌─────────────┐  ┌────────────┐
              │ Postgres 18  │  │ Qdrant     │  │ gbrain      │  │ Graphiti    │
              │ + RLS strict │  │ vectors    │  │ memory API  │  │ Neo4j graph │
              └──────────────┘  └────────────┘  └─────────────┘  └────────────┘
```

All services run as Docker containers locally. Detail in `docs/ARCHITECTURE.md`.

---

## What's actually built (by service)

### `apps/paperclip/` — orchestrator + dashboard *(TypeScript)*

The core service. Everything else flows through here.

**29 route files:**
agents · approvals · audit · brain · briefings · captures · channels · documents · goals · health · heartbeat · inbox · keyresults · knowledge · llm · onboarding · orgs · payments · policies · routines · runs · search · self_improvement · skills · stats · tools · ui · upstream · webhooks

**Subsystems:**
- **Worker** — claims queued runs, dispatches to agent adapters via HTTP, polls until terminal
- **Scheduler** — periodic tick: cron-driven routines, event-triggered routines, daily/per-user briefings, **upstream knowledge auto-pull** (every registered URL on its interval)
- **Policy engine** — `(role, agent_kind, skill_slug, action_kind) → allow | approve | deny`, gates every skill invocation
- **Simulation** — `mode='simulation'` previews what a dispatch *would* do without firing side effects
- **Audit** — every mutation writes a row in `core.audit_log` with org + actor scope
- **AI gateway** — every LLM call routes through Portkey (Anthropic + OpenRouter virtual keys)

**193 vitest cases.**

### `packages/cli/` — `bc` command *(TypeScript)*

49 dispatch cases. Hand-rolled argv parser, no commander dep. Editorial pretty output by default; `--json` for pipes.

**Verbs:**
- **Goals** — `goals`, `goal <id>`, `goals --summary`, `goals --stalled`, `close`, `pause`, `resume`, `archive`
- **Runs** — `runs`, `run <id> [--watch]`, `dispatch <goal>`, `dispatch --simulate`, `feedback <run>`
- **Skills + Tools** — `skills`, `skill invoke`, `tools`, `tool invoke`, `tool probe`, `tool <slug>`, `tool remove`
- **Captures + Brain** — `capture <text>`, `inbox`, `inbox ack`, `brain`, `search`, `tail`
- **Documents** — `doc add <file>`, `doc add --url=`, `docs`, `docs search`, `doc <id>`, `doc remove`
- **Upstream** — `upstream add`, `upstream pull`, `upstream enable/disable`, `upstream remove`
- **KRs** — `kr list/add/set/rm`
- **Briefings** — `briefing`, `briefing list`
- **Policies** — `policies`, `policy add/rm/test`
- **Payments** — `payments status/enable/disable/configure`, `payments kill/resume`, `payments limits/requests`
- **Approvals** — `approvals`, `approve <id>`, `decline <id>`, `approvals --summary`
- **Observability** — `llm [--summary]`, `heartbeat`, `logs`, `stats`
- **Knowledge wiki** — `knowledge`, `knowledge get`
- **Channels + Depts** — `channels`, `depts`
- **Self-improvement** — `audit`, `level-up`
- **Routines** — `routines`, `triggers`, `fire`
- **Setup** — `whoami`, `health`, `onboard`, `version`, `help`

**31 vitest cases.** Build target: `bc` linked globally via `make cli`.

### `apps/hermes/` — general-purpose reasoning agent *(Python · FastAPI)*

Per-run loop: pull goal context from gbrain → reason via Portkey-routed Anthropic → produce output. Brand voice loaded from `brand/blankcollar.md`. **24 pytest cases.**

### `apps/openclaw/` — tool/web-action agent *(Python · FastAPI)*

Executes side-effecting skills: `web.fetch`, `web.search`, Google Workspace (`gmail.search`, `calendar.create_event`, `drive.search`, `docs.append`, `sheets.append_row`) via Nango. Same adapter contract as Hermes.

### `apps/langgraph/` — multi-agent dispatcher *(Python · FastAPI)*

Classifier node decides whether a subtask goes to Hermes or OpenClaw. Routes through Portkey. **17 pytest cases.**

### `apps/gbrain/` — memory layer *(Python · FastAPI)*

Embedding pipeline (`text-embedding-3-small`) → Qdrant per-`(org, kind)` collections. Role-scoped recall (auditor/owner read-all; team_member/agent gated by `visible_to`). Audit-logged remember/forget.

### `apps/graphiti/` — temporal knowledge graph *(Python · FastAPI)*

Wraps `graphiti-core` over Neo4j. Per-`(org, dept, goal)` `group_id` partitioning. Used by gbrain to add episodic facts. **5 pytest cases.** *Note: graphiti-core uses its own LLM client; Portkey routing for it is a deferred follow-up.*

### `apps/email-ingest/` — IMAP poller *(Python)*

Poll inboxes → write conversation memories to gbrain → POST actionable mail to `/api/capture`. No LLM calls of its own.

### `packages/skills/manifests/` — capability YAML

Each skill = one YAML file declaring `id`, `version`, `agent_kind`, `inputs`, `side_effects`, `permissions`. Boot-time `syncSkillRegistry` mirrors them into `ops.skill`. Currently shipping in `shared/`: `web.fetch`, `web.search`, `email.send`, `google.gmail.search`, `google.calendar.create_event`, `google.drive.search`, `google.docs.append`, `google.sheets.append_row`.

### `packages/tools/manifests/` — MCP tool YAML

Same shape as skills, for MCP servers. Currently shipping in `shared/`: `web.fetch`, `postgres.query`. Boot-time `syncToolRegistry` mirrors them into `ops.tool`. Background probe at boot auto-disables broken tools.

---

## Database schema

Three schemas in Postgres 18: `core` (identity), `ops` (operations), `brain` (memory metadata).

**Tenant tables (RLS-strict by default):**
- `ops.goal`, `ops.run`, `ops.agent`, `ops.key_result`, `ops.goal_contributor`
- `ops.briefing`, `ops.capture`, `ops.knowledge_doc`, `ops.knowledge_link`
- `ops.skill`, `ops.tool`, `ops.routine_trigger`, `ops.onboarding_profile`
- `ops.audit_report`, `ops.policy`, `ops.approval`
- `ops.payment_settings`, `ops.agent_spending_limit`, `ops.payment_request`, `ops.kill_switch_event`
- `ops.tool_call_log`, `ops.llm_call_log`, `ops.run_feedback`
- `ops.document`, `ops.document_chunk`, `ops.upstream_source`
- `brain.memory`, `core.audit_log`

**Identity tables (not RLS-enabled):**
- `core.organization`, `core.department`, `core.user_account`, `core.role_assignment`

**Other:**
- `billing.stripe_event` (idempotent webhook intake)

Detail in `docs/SCHEMA.md` and `apps/paperclip/src/bootstrap.ts`.

---

## Phase progression

| Phase | What | Status |
|---|---|---|
| **0** Groundwork | Monorepo, docker-compose, Postgres+Qdrant, init.sql, README/docs | ✅ |
| **1** Memory layer | gbrain HTTP API, embeddings, Qdrant, audit-log | ✅ |
| **2** Paperclip orchestrator | Fastify API, run queue, agent registry, htmx dashboard | ✅ |
| **3** First real workforce | Hermes + OpenClaw containers, adapter contract, web.fetch, plan generator | ✅ |
| **3.5** Backend tightening | Goal kinds, KRs, captures, briefings, inbox, brain graph, RLS, scheduler, scheduled briefing, skills + routines + approvals + governance, **bc CLI**, OpenClaw Workspace connectors, Phase 9 payments primitives, MCP tool registry, policy engine | ✅ |
| **2.0–2.6** Local development *(this session)* | Pre-flight cleanup, Portkey AI gateway, MCP client, simulation + feedback, document ingestion, upstream auto-pull, RLS strict flip | ✅ |
| **3** Cloud migration | Hetzner / Supabase / Neo4j Aura / Coolify / RunPod | not started |
| **4** Goal Command Centre | React/Vite console replacing the htmx dashboard | not started |
| **5** Intelligence layer | Already largely shipped (skills, tools, policy, approvals); MCP-server-mode is the remaining pure-5 item | partially shipped |
| **6** Auth & multi-tenancy | Supabase JWT enforcement, invite flows | not started |
| **7** Payments + onboarding | Stripe billing, onboarding wizard | not started |
| **8** Public launch | Marketing site, marketplace | not started |
| **9** Agent payments (outbound spend) | Backend safety primitives shipped (settings, limits, kill switch); Stripe connector + Finance Agent are the remaining steps | partially shipped |

Detail in `docs/ROADMAP.md`.

---

## What this session shipped (Phase 2.0 → 2.6)

Across 24 commits and 7 sprints, the local-first phase delivered:

| Sprint | Outcome |
|---|---|
| **2.0** Pre-flight cleanup | `make smoke-local`, `bc --version`, ROADMAP dedup, ARCHITECTURE doc on scope helpers |
| **2.1** Portkey gateway | Every LLM call routed through Portkey (paperclip TS + Hermes + LangGraph). OpenRouter as a sibling virtual key. `ops.llm_call_log` + `bc llm` cost view. Required at boot. |
| **2.2** MCP client | `ops.tool_call_log`, stdio JSON-RPC client, `POST /api/tools/:slug/invoke + /probe`, `bc tool invoke + probe`, boot-time auto-disable of broken tools |
| **2.3** Simulation + Feedback | `mode='simulation'` previews subtasks without firing side effects (default-deny on unknown skills). `ops.run_feedback` + 1-5 rating + tags + free-form note. `bc dispatch --simulate` + `bc feedback` |
| **2.4** Document ingestion | `ops.document` + `ops.document_chunk`, deterministic paragraph-aware chunker, sha256 dedupe, `bc doc add <file>` + `bc doc add --url=`, keyword search, mime-aware (PDF deferred) |
| **2.5** Upstream auto-pull | `ops.upstream_source` + scheduler tick + atomic hash-compare-and-replace, 5-failures auto-disable, `bc upstream add/pull/enable/disable/remove` |
| **2.6** RLS strict flip | `PAPERCLIP_RLS_STRICT=true` (default) — unscoped queries return 0 rows; `audit.ts` self-wraps; `ui.ts`/`stripe.ts` migrated; boot log declares mode |

**Net additions:** +128 paperclip tests (65 → 193), +5 CLI tests (26 → 31), +5 hermes tests (19 → 24), 7 new docs files, 4 new database tables, ~25 new endpoints, ~30 new CLI commands.

---

## How to run it locally

```bash
# Once: create your .env from the template
cp .env.example .env

# Once: paste your Portkey + OpenRouter keys into .env
make setup-keys                           # interactive prompter, hidden input

# First boot
make bootstrap                            # docker compose up + healthcheck

# Day-to-day
make doctor                               # health-check every service
bc capture "Reply to Mira about the proposal"
bc inbox
bc briefing
bc dispatch <goal-id> --simulate          # preview before firing
bc dispatch <goal-id>                     # actually run
bc llm --summary                           # see today's LLM cost
bc upstream add https://docs.anthropic.com/...
bc doc add ./meeting-notes.md
```

Full walkthrough in `docs/LOCAL_SETUP.md`.

---

## Quality gates

Every commit on `main` passes:

- `make gates` — typecheck + lint + tests across paperclip and CLI
- `docker compose config -q` — compose file is valid
- All 270 tests green
- Every `${VAR}` in `docker-compose.yml` is also in `.env.example`

CI: `.github/workflows/ci.yml` runs the same gates on every push and PR.

---

## Documentation map

Where to look for what:

- **`README.md`** — start here; quickstart + philosophy
- **`docs/ROADMAP.md`** — phase-by-phase build progress (this is the historical record)
- **`docs/STATUS.md`** — *this file* — what's built today (the inventory)
- **`docs/ARCHITECTURE.md`** — system layers + contracts + scope helpers + AI gateway + simulation
- **`docs/API.md`** — every HTTP endpoint, request + response shape
- **`docs/SCHEMA.md`** — every database table
- **`docs/LOCAL_SETUP.md`** — Mac + Docker Desktop walkthrough, troubleshooting
- **`docs/ENVIRONMENT.md`** — every env var, what it does, where to get its value
- **`docs/QA_CHECKLIST.md`** — the gates a change must pass before merging
- **`docs/INGESTION.md`** — document ingestion + upstream auto-pull operator playbook
- **`docs/TOOLS.md`** — MCP tool manifest format + invocation + probe
- **`docs/SKILLS.md`** — skill manifest format + dispatch
- **`docs/ROLES.md`** — owner / department_lead / team_member / auditor / agent semantics
- **`docs/GOAL_FIRST.md`** — why the system exposes goals not agents
- **`docs/COMPANY_BRAIN.md`** — gbrain + Qdrant + Postgres memory model
- **`docs/GRAPHITI.md`** — temporal knowledge graph
- **`docs/LANGGRAPH.md`** — multi-agent classifier
- **`docs/NANGO.md`** — OAuth + tool integrations gateway
- **`docs/DESIGN_MD.md`** — Brand Foundation runtime layer (Hermes voice + email lint)
- **`docs/AGENTS.md`** — workforce concept + the four agent kinds
- **`docs/INTEGRATION_PLAN.md`** — Phase 3.5 four-Cs extension plan
- **`docs/OBSERVABILITY.md`** — what we log, where it goes
- **`docs/STRIPE.md` / `docs/STRIPE_LOCAL.md`** — payment webhooks (Phase 7 prep)
- **`docs/SUPABASE_LOCAL.md`** — auth integration (Phase 6 prep)
- **`docs/HOSTINGER_DEPLOY.md` / `docs/DEPLOYMENT.md`** — Phase 3 cloud notes
- **`docs/MARKETING.md` / `docs/USE_CASES.md` / `docs/VISION.md`** — narrative + sales context
- **`docs/FAQ.md` / `docs/GLOSSARY.md` / `docs/COMPARISON.md`** — orientation
- **`docs/BACKUP_RESTORE.md`** — data recovery
- **`docs/TESTING.md`** — test taxonomy + how to add new ones
- **`docs/PLAYWRIGHT.md`** — `web.browse` skill notes
- **`docs/PAPERCLIP_REAL.md`** — the upstream `paperclipai` npm tool wrapper
- **`docs/ONBOARDING.md`** — interview flow + derived config

---

## What's deferred (transparent)

Carried into future sprints, not blocking Phase 2 completion:

- **Graphiti through Portkey** — graphiti-core uses its own internal OpenAI client; routing it through Portkey needs upstream library support or a base-URL override pattern.
- **Vector embeddings of document chunks** — chunks land in Postgres with GIN keyword search today; the async "embed every new chunk via gbrain" worker is the natural follow-up.
- **PDF parsing** for `ops.document` — needs a parser library; markdown + URL covers the common case for now.
- **Real headless URL extraction** — for SPAs / paywalled / JS-only sites. Today's regex strip handles ~80% of clean articles.
- **Authenticated upstream sources** — public URLs only. Auth headers per source come if/when needed.
- **Conditional GET (`If-None-Match`)** for upstream pulls — would save bandwidth.
- **MCP server transport** (Paperclip-as-MCP-server) — registry + client are shipped; exposing our skills *as* an MCP server for external Claude/Cursor is Phase-5 follow-up.
- **HTTP / SSE / WebSocket** MCP transports — only stdio is wired today.
- **Stripe connector + Finance Agent** for outbound payments — schema + safety primitives are shipped; the executor lives in Phase 9 cloud sprint.
- **Per-role enforcement on writes** — Phase 6 work.

---

## What's NOT in scope (intentional)

- **The React console (Phase 4)** — htmx dashboard works fine for the operator's needs through Phase 3. The Swiss-editorial console replaces it after the cloud migration is stable.
- **Multi-tenancy auth UI (Phase 6)** — Supabase JWT verification is server-side ready; the UI for invites/role-management waits for the React console.
- **Public marketing site (Phase 8)** — separate concern from the OS itself.
- **Cloud migration (Phase 3)** — explicitly held until local stack is rock-solid. Phase 2.6 closed that gate.

---

## Owner notes

- License: MIT
- Owner: Kristian Kabashi · [@theblankcollar](https://github.com/theblankcollar)
- Future home: [www.blankcollar.ai](https://www.blankcollar.ai)
- Future inbox: `agent@blankcollar.ai`

The repo is private during local-development. Phase 8 (Public Launch) is when this changes.
