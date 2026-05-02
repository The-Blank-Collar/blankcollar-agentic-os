# 🤖 The Blank Collar — Agentic OS

> **"Work is for bots. Life is for humans."**
>
> An AI Operating System so simple your grandma could run a company with it,
> and so powerful that a serious operator can scale a multi-agent business on top of it.

[![Status](https://img.shields.io/badge/status-phase%202%20complete-brightgreen)]()
[![Tests](https://img.shields.io/badge/tests-270%20passing-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()
[![Local-first](https://img.shields.io/badge/local--first-yes-brightgreen)]()
[![Docker](https://img.shields.io/badge/docker-ready-2496ED)]()

- 🌐 Future home: [www.blankcollar.ai](https://www.blankcollar.ai)
- 📧 Future agent inbox: `agent@blankcollar.ai`
- 👤 Owner: Kristian Kabashi — [www.theblankcollar.com](https://www.theblankcollar.com)

---

## 📖 Table of Contents

1. [What's built today](#-whats-built-today)
2. [What is Blank Collar?](#-what-is-blank-collar)
3. [Philosophy: Goal‑First, Not Agent‑First](#-philosophy-goalfirst-not-agentfirst)
4. [System Architecture](#-system-architecture)
5. [The Core Stack](#-the-core-stack)
6. [Repository Layout](#-repository-layout)
7. [Quick Start (Mac + Docker Desktop)](#-quick-start-mac--docker-desktop)
8. [The `bc` CLI](#-the-bc-cli)
9. [Roles & Scoped Access](#-roles--scoped-access)
10. [The Company Brain](#-the-company-brain)
11. [QA & Debugging Checklist](#-qa--debugging-checklist)
12. [Roadmap](#-roadmap)
13. [Documentation Map](#-documentation-map)
14. [Contributing](#-contributing)
15. [License](#-license)

---

## ⚡ What's built today

> **End of Phase 2 (local-first development).** Phase 3 (cloud) and Phase 4 (UI) are next.

| | |
|---|---|
| Source files | ~6 100 |
| Tests | **270 passing** (193 paperclip + 31 CLI + 24 hermes + 17 langgraph + 5 graphiti) |
| API endpoints | 29 route files in `apps/paperclip/src/routes/` |
| CLI commands | 49 dispatch cases in `bc help` |
| Docs | 38 markdown files in `docs/` |
| Database tables | ~30 across `core` / `ops` / `brain` schemas |

**What's in the box** — running services + the latest local-first features:

- 🧠 **Memory** — `gbrain` semantic recall + Qdrant + `Graphiti` temporal graph
- 👥 **Workforce** — Hermes (reasoning) + OpenClaw (tools/web) + LangGraph (dispatcher)
- 🎯 **Goal-first orchestrator** — Paperclip with goal kinds, KRs, captures, briefings, inbox
- 🛠 **Skills + Tools** — YAML manifests + MCP client (stdio) + boot-time tool probe
- 🔍 **Policy engine** — gates every skill call: `allow | approve | deny`
- 🎬 **Simulation** — `bc dispatch --simulate` previews any run before firing side effects
- 📥 **Document ingestion** — `bc doc add` files / URLs into the brain (chunked, deduped)
- 🔄 **Upstream auto-pull** — register URLs; the scheduler keeps them fresh
- 💸 **Payment safety** — settings, per-agent caps, kill switch (Stripe connector deferred)
- 📊 **Observability** — every LLM call routed through Portkey, every tool/run/audit logged
- 🔒 **Tenant isolation** — RLS strict-by-default; unscoped queries return 0 rows
- 📝 **Feedback loop** — rate any run 1-5 + tags + notes, fed into the audit/level-up pass

**Full inventory** with every file, table, command, and deferred item: [`docs/STATUS.md`](docs/STATUS.md).

---

## 🧠 What is Blank Collar?

**Blank Collar** is an open, local‑first **Agentic Operating System** designed to run an entire
AI‑powered company — products, support, sales, ops, content, finance — from a single dashboard.

Where most agent frameworks expose raw agents, terminals, and prompts, Blank Collar exposes
**business goals**. You hire a "department," set a goal, and the system orchestrates agents,
tools, and memory to deliver outcomes.

**Why "Blank Collar"?**
We're past white‑collar and blue‑collar. The future workforce wears no collar at all.

---

## 🎯 Philosophy: Goal‑First, Not Agent‑First

Most agent platforms make you think like a developer:

> "Spin up an agent → give it a prompt → wire its tools → watch the logs."

**Blank Collar flips that.** You think like a CEO:

> "Grow newsletter signups by 10% this month."
> "Process every invoice that hits agent@blankcollar.ai."
> "Onboard new customers within 24 hours of purchase."

The OS translates goals into:
- **Departments** (Marketing, Sales, Support, Finance, Engineering, …)
- **Roles** within each department (Lead, Specialist, Reviewer)
- **Skills & tools** the role needs (MCP tools, integrations, knowledge)
- **Agents** that execute the work — chosen and configured by the OS

You manage **outcomes**, the OS manages **execution**.

> 📚 Full philosophy doc: [`docs/GOAL_FIRST.md`](docs/GOAL_FIRST.md)

---

## 🧭 The Four Cs — How the OS is organised

Every backend module belongs to one of four pillars. New code that doesn't map to one is a smell.

| Pillar          | Question it answers       | Where it lives                                                                       |
|-----------------|---------------------------|---------------------------------------------------------------------------------------|
| **Context**     | *What does the OS know?*  | `gbrain` (semantic recall) + `Graphiti` (temporal graph) + `ops.knowledge_doc` (wiki) |
| **Connections** | *What can it reach?*      | `Nango` (400+ services) + Google Workspace connectors + `apps/email-ingest`           |
| **Capabilities**| *What can it do?*         | Skills Engine (`packages/skills/`) routed through Hermes / OpenClaw / LangGraph       |
| **Cadence**     | *When does it act?*       | Routines Engine — scheduler in Paperclip + event-triggered routines + audit-driven    |

Operating modes — every component is **mode-aware**:
- **Single-user** (personal AIOS) — one human, one org, role=`owner`, dept=`NULL`. `make personal` lands you here.
- **Multi-user** (company / team) — multiple humans + departments, role-scoped, RLS-enforced.

The same data model serves both; the difference is which scopes are populated. See [`docs/INTEGRATION_PLAN.md`](docs/INTEGRATION_PLAN.md) for how the Four Cs connect end-to-end and how each new feature wires into the existing pipeline.

---

## 🏗 System Architecture

```
                      ┌──────────────────────────────────┐
                      │        Goal Command Centre       │   ← human-facing UX
                      │  (Paperclip dashboard, future)   │      "manage goals"
                      └─────────────────┬────────────────┘
                                        │
                      ┌─────────────────▼────────────────┐
                      │        Paperclip Orchestrator    │   ← turns goals into
                      │     (planner · router · queue)   │      runs & supervises
                      └─┬──────────┬──────────┬──────────┘
                        │          │          │
                  ┌─────▼───┐ ┌────▼───┐ ┌────▼─────┐
                  │ Hermes  │ │OpenClaw│ │  Future  │   ← workforce
                  │ Agent   │ │ Agent  │ │  Agents  │      (swappable)
                  └────┬────┘ └────┬───┘ └────┬─────┘
                       │           │          │
                  ┌────▼───────────▼──────────▼─────┐
                  │           gbrain (memory)       │   ← Company Brain
                  │   semantic + episodic + facts   │      (scoped per role)
                  └────┬────────────────────────────┘
                       │
              ┌────────▼─────────┐    ┌──────────────────┐
              │ Qdrant (vectors) │    │ PostgreSQL (state)│
              └──────────────────┘    └───────────────────┘
```

> 📚 Deeper dive: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## 🧱 The Core Stack

| Layer            | Component             | Purpose                                                                                      | Status |
|------------------|-----------------------|----------------------------------------------------------------------------------------------|--------|
| Orchestrator     | **Paperclip**         | Fastify (TypeScript) — 29 route files, run queue, scheduler, policy engine, simulation       | ✅ on `:3000` |
| Operator CLI     | **`bc`**              | 49-command operator interface — `bc capture / dispatch / doc add / upstream / llm / …`       | ✅ via `make cli` |
| Workforce        | **Hermes Agent**      | General-purpose reasoning agent (Portkey-routed Anthropic, deterministic fake fallback)      | ✅ on `:8001` |
| Workforce        | **OpenClaw Agent**    | Tool/web-action agent — `web.fetch`, `web.search`, Google Workspace via Nango                | ✅ on `:8002` |
| Workforce        | **LangGraph**         | Multi-agent dispatcher routing subtasks to Hermes or OpenClaw                                | ✅ on `:8004` |
| Memory           | **gbrain**            | Semantic + episodic memory layer (role-scoped, Qdrant-backed)                                | ✅ on `:8003` |
| Memory           | **Graphiti**          | Temporal knowledge graph (Neo4j-backed) bridged from gbrain                                  | ✅ on `:8005` |
| Email ingest     | **email-ingest**      | IMAP poller → conversation memories + actionable mail to `/api/capture`                      | ✅ |
| AI gateway       | **Portkey**           | Single chokepoint for every LLM call (Anthropic + OpenRouter virtual keys); cost/latency log | ✅ required at boot |
| Connectors       | **Nango**             | OAuth gateway (400+ services) — Google Workspace wired today                                 | ✅ |
| Vector store     | **Qdrant**            | Embeddings + similarity search                                                               | ✅ on `:6333` |
| Relational store | **PostgreSQL 18**     | Structured state, RLS strict-by-default, ~30 tenant-scoped tables                            | ✅ on `:5432` |
| Auth (future)    | **Supabase**          | Hosted auth + role management (Phase 6)                                                       | server-side ready |
| Payments (future)| **Stripe**            | Inbound billing (Phase 7) + outbound spend (Phase 9 — safety primitives shipped)             | webhook + safety table ready |
| Local platform   | **Docker Compose**    | One command to run the entire stack                                                           | ✅ |

> Each component lives in its own folder under `apps/` or `packages/` and is **swappable**.

---

## 🗂 Repository Layout

```
blankcollar-agentic-os/
├── apps/
│   ├── paperclip/          # Fastify orchestrator (TypeScript) — 29 routes, scheduler, worker
│   ├── hermes/             # Reasoning agent (Python · FastAPI)
│   ├── openclaw/           # Tool/web-action agent (Python · FastAPI)
│   ├── langgraph/          # Multi-agent dispatcher (Python · FastAPI)
│   ├── gbrain/             # Memory layer (Python · FastAPI · Qdrant)
│   ├── graphiti/           # Temporal knowledge graph (Python · FastAPI · Neo4j)
│   ├── email-ingest/       # IMAP → /api/capture (Python)
│   ├── auth/               # Supabase JWT helpers (placeholder for Phase 6)
│   ├── billing/            # Stripe webhook handler (placeholder for Phase 7)
│   ├── paperclip-real/     # Wrapper for upstream paperclipai npm tool
│   └── website/            # React/Vite console (Phase 4 placeholder)
├── packages/
│   ├── cli/                # `bc` operator command — 49 verbs
│   ├── skills/manifests/   # YAML capability definitions (web.fetch, email.send, …)
│   ├── tools/manifests/    # YAML MCP tool definitions (web.fetch, postgres.query, …)
│   ├── agents/             # Shared agent contracts
│   ├── gbrain/             # Memory client TS bindings
│   └── shared/             # Cross-package types
├── infra/
│   ├── docker/
│   │   └── postgres/       # init.sql — core schemas
│   ├── caddy/              # Reverse proxy config
│   └── scripts/
│       ├── bootstrap.sh    # First-run setup
│       ├── doctor.sh       # Health-check the local stack
│       ├── smoke.sh        # End-to-end live API smoke test
│       ├── setup-keys.sh   # Interactive .env prompter (hidden input)
│       ├── personal.sh     # Single-user bootstrap
│       └── reset.sh        # Wipe local volumes
├── docs/                   # 38 markdown files — see Documentation Map below
├── .github/                # CI workflow + Dependabot + CODEOWNERS
├── docker-compose.yml      # The whole stack
├── .env.example            # Every env var (copy to .env, then `make setup-keys`)
├── Makefile                # Ergonomic wrappers: bootstrap, up, doctor, gates, smoke, …
└── README.md
```

---

## ⚡ Quick Start (Mac + Docker Desktop)

### Prerequisites

| Tool             | Minimum version | Install                                                       |
|------------------|-----------------|---------------------------------------------------------------|
| macOS            | 13+             | —                                                             |
| Docker Desktop   | 4.30+           | https://www.docker.com/products/docker-desktop                |
| Git              | 2.40+           | `brew install git`                                            |
| Make (optional)  | any             | preinstalled                                                  |

> Make sure Docker Desktop is **running** (whale icon in the menu bar) before continuing.

### 1. Clone the repo

```bash
git clone https://github.com/The-Blank-Collar/blankcollar-agentic-os.git
cd blankcollar-agentic-os
```

### 2. Copy the example env file

```bash
cp .env.example .env
```

### 3. Set up the required keys

Paperclip is **Portkey-required at boot** — it refuses to start without a Portkey API key + Anthropic virtual key. The interactive prompter handles this without secrets touching shell history:

```bash
make setup-keys
```

You'll be walked through 8 keys (only the first two are required):

1. `PORTKEY_API_KEY` — get one at [app.portkey.ai](https://app.portkey.ai/api-keys)
2. `PORTKEY_VIRTUAL_KEY_ANTHROPIC` — create in Portkey dashboard → Virtual Keys → + Add → Anthropic
3. `PORTKEY_VIRTUAL_KEY_OPENROUTER` — *(optional)* sibling virtual key for non-Anthropic models
4. `ANTHROPIC_API_KEY` — *(optional)* used by Graphiti directly
5. `OPENAI_API_KEY` — *(optional)* used by Graphiti + gbrain embeddings
6. `INBOUND_CAPTURE_WEBHOOK_SECRET` — *(optional)*
7. `NANGO_SECRET_KEY` — *(optional)* for Workspace OAuth
8. `SUPABASE_JWT_SECRET` — *(optional, Phase 6)*

Hit Enter to skip any optional key. Walkthrough: [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

### 4. Start the stack

```bash
make bootstrap          # first-run: Docker check, .env, pull, up, healthcheck
# …or for daily use:
make up                 # start in the background
```

> Run `make help` to see every shortcut (`up`, `down`, `doctor`, `psql`, `logs`, `gates`, `smoke`, `reset`, `cli`, `setup-keys`, …).

This brings up:
- **Paperclip API + dashboard** on http://localhost:3000
- **Hermes** on http://localhost:8001
- **OpenClaw** on http://localhost:8002
- **gbrain** on http://localhost:8003
- **LangGraph** on http://localhost:8004
- **Graphiti** on http://localhost:8005
- **PostgreSQL 18** on `localhost:5432`
- **Qdrant** on `localhost:6333` (REST) / `localhost:6334` (gRPC)
- **Nango** on http://localhost:3003
- **pgAdmin** on http://localhost:5050 *(via `make up-tools`)*

### 5. Verify everything is healthy

```bash
make doctor             # health-check every service
make smoke              # full live-API exercise (capture → inbox → briefing → docs → upstream → tools → RLS)
```

Expected: ✅ for every service.

### 6. Use it

```bash
make cli                # build + link the `bc` CLI globally
bc capture "Reply to Mira about the Lark proposal"
bc inbox
bc briefing
```

> 📚 Full local setup walkthrough (with troubleshooting):
> [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md)

### Stopping the stack

```bash
docker compose down            # stop containers, keep data
docker compose down -v         # stop AND wipe data (fresh slate)
./infra/scripts/reset.sh       # interactive reset with confirmation
```

---

## ⌨️ The `bc` CLI

Operator interface to every Paperclip endpoint. Pretty editorial output by default; `--json` for pipes. 49 verbs grouped by intent:

```bash
# Goals + runs
bc capture "Reply to Mira about the proposal"     # natural-language intake
bc goals                                           # list active
bc goal <id> --stats                               # detail + run rollup
bc dispatch <goal-id> --simulate                   # preview without firing
bc dispatch <goal-id>                              # actually run
bc run <id> --watch                                # SSE-stream live status

# Brain (memory + ingestion)
bc doc add ./meeting-notes.md                      # ingest a markdown file
bc doc add --url=https://docs.anthropic.com/...    # fetch + ingest
bc upstream add <url> --interval=86400              # auto-refresh on a schedule
bc docs search "quarterly target"                  # keyword search across chunks
bc search "Mira"                                    # cross-corpus search

# Observability
bc llm --summary                                    # today's LLM cost + latency
bc tail                                             # most-recent runs
bc heartbeat                                        # 14-day pulse sparklines
bc logs                                             # audit log entries
bc whoami                                           # resolved scope

# Skills + tools
bc skills                                           # list available capabilities
bc tool invoke web.fetch --input.url=...           # call an MCP tool
bc tool probe <slug>                                # liveness check

# Governance
bc approvals --summary                              # what's awaiting decision
bc policies                                         # role/agent/skill → effect rules
bc policy add --effect=deny --skill=email.send

# Feedback (closes the audit/level-up loop)
bc feedback <run-id> --rating=4 --tag=helpful
```

Full command list: `bc help`. Full reference: [`packages/cli/README.md`](packages/cli/README.md).

---

## 🔐 Roles & Scoped Access

From day one, Blank Collar is built for **multi‑user, role‑based** access.
You should never give an intern‑level agent the keys to billing.

| Role               | Sees                                  | Can do                                              |
|--------------------|---------------------------------------|-----------------------------------------------------|
| **Owner**          | Everything                            | Manage company, billing, users, all goals           |
| **Department Lead**| Their department's goals & memory     | Create goals, manage department agents              |
| **Team Member**    | Assigned goals only                   | Execute, comment, raise blockers                    |
| **Auditor**        | Read‑only across the company          | Inspect runs, exports, compliance                   |
| **Agent (system)** | Whatever the role grants it           | Tool calls scoped by the role of the goal owner     |

Scoping is enforced at three layers:
1. **API**: every request carries a role; controllers check it.
2. **gbrain**: memory queries are filtered by `(department, role, goal_id)`.
3. **Tools**: skills & MCP tools are gated by role policy.

> 📚 Roles deep dive: [`docs/ROLES.md`](docs/ROLES.md)

---

## 🧠 The Company Brain

The **Company Brain** = `gbrain` + Qdrant + PostgreSQL working as one.

- **Facts**: structured truths about the company ("we charge $29/mo", "our brand voice is …").
- **Episodic memory**: what happened, when, by which agent, on which goal.
- **Semantic memory**: documents, conversations, knowledge — embedded into Qdrant.
- **Scoped retrieval**: every read is filtered by role + department + goal.

The Brain is **persistent across runs and agents**. A new agent hired tomorrow inherits
the company's collective memory the moment it's onboarded.

> 📚 Brain design: [`docs/COMPANY_BRAIN.md`](docs/COMPANY_BRAIN.md)

---

## ✅ QA & Debugging Checklist

Run through this **before merging any PR** and **after every `docker compose up`** during
development.

- [ ] `docker compose ps` — every service shows `running` / `healthy`
- [ ] `./infra/scripts/doctor.sh` exits 0
- [ ] Postgres reachable: `psql postgresql://postgres:postgres@localhost:5432/blankcollar -c "\dt"`
- [ ] Qdrant reachable: `curl -s http://localhost:6333/healthz`
- [ ] Paperclip placeholder responds: `curl -s http://localhost:3000`
- [ ] No errors in `docker compose logs --tail=200`
- [ ] `.env` is **not** committed (run `git status` and confirm)
- [ ] `.env.example` lists every variable used in `docker-compose.yml`
- [ ] No service hardcodes secrets — everything via env
- [ ] Volumes named with `bc_` prefix so they don't collide with other projects
- [ ] README screenshots / examples still match reality

> 📚 Full QA checklist: [`docs/QA_CHECKLIST.md`](docs/QA_CHECKLIST.md)

---

## 🛣 Roadmap

| Phase | Theme                                  | Status                                                                 |
|-------|----------------------------------------|------------------------------------------------------------------------|
| 0     | Groundwork                             | ✅ Monorepo, Docker stack, init.sql, doctor.sh                          |
| 1     | Real memory layer                      | ✅ gbrain HTTP, Qdrant, role-scoped recall                              |
| 2     | Paperclip orchestrator                 | ✅ Full `/api/*`, run queue, agent registry, htmx dashboard             |
| 3     | First real workforce                   | ✅ Hermes + OpenClaw + LangGraph, web skills, Nango, Graphiti           |
| 3.5   | Backend tightening                     | ✅ Goal kinds, captures, briefings, inbox, scheduler, RLS, Four Cs, Skills Engine, Routines Engine, Onboarding, Self-Improvement, Knowledge wiki, payments primitives |
| **2.0–2.6** | **Local-first development pass** | ✅ **Portkey AI gateway + MCP client + simulation/feedback + document ingestion + upstream auto-pull + RLS strict flip** |
| 3     | Cloud migration                        | not started — Hetzner / Supabase / Neo4j Aura / Coolify / RunPod       |
| 4     | Goal Command Centre                    | not started — Vite + React console replaces htmx dashboard             |
| 5     | Intelligence layer                     | partial — skills/tools/policy/approvals shipped; MCP-server-mode left  |
| 6     | Auth & multi-tenancy                   | not started — Supabase JWT enforcement + invite flows                  |
| 7     | Payments & onboarding                  | not started — Stripe billing UI + onboarding wizard                    |
| 8     | Public launch                          | not started — www.blankcollar.ai + skill marketplace                   |
| 9     | Agent payments (outbound)              | partial — safety primitives shipped; Stripe connector + Finance Agent left |

> 📚 Full roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md) · Today's inventory: [`docs/STATUS.md`](docs/STATUS.md)

---

## 📚 Documentation Map

The full documentation set lives in [`docs/`](docs/). Use this map to find what you need:

### Where we are right now

- [`docs/STATUS.md`](docs/STATUS.md) — *the inventory* — every service, table, command, and deferred item, as of the last commit.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phase-by-phase historical record.

### Why & what

- [`docs/VISION.md`](docs/VISION.md) — The standalone Blank Collar manifesto.
- [`docs/GOAL_FIRST.md`](docs/GOAL_FIRST.md) — The single most important design constraint.
- [`docs/BRAND.md`](docs/BRAND.md) — Voice, naming, copy, visual direction.
- [`docs/MARKETING.md`](docs/MARKETING.md) — Positioning, copy bank, launch plan.
- [`docs/USE_CASES.md`](docs/USE_CASES.md) — Five concrete personas the OS is built for.
- [`docs/COMPARISON.md`](docs/COMPARISON.md) — Blank Collar vs CrewAI, AutoGen, n8n, ChatGPT.
- [`docs/FAQ.md`](docs/FAQ.md) — Beginner-first Q&A.

### How

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Layered model, contracts.
- [`docs/INTEGRATION_PLAN.md`](docs/INTEGRATION_PLAN.md) — Four Cs extension + how every new module wires into the existing pipeline.
- [`packages/cli/README.md`](packages/cli/README.md) — `bc` command-line interface.
- [`docs/ROLES.md`](docs/ROLES.md) — Role model + 3-layer enforcement.
- [`docs/COMPANY_BRAIN.md`](docs/COMPANY_BRAIN.md) — gbrain + Qdrant + Postgres design.
- [`docs/GRAPHITI.md`](docs/GRAPHITI.md) — Temporal knowledge graph (Neo4j) bridged from gbrain.
- [`docs/LANGGRAPH.md`](docs/LANGGRAPH.md) — Multi-agent dispatcher routing to Hermes + OpenClaw.
- [`docs/PLAYWRIGHT.md`](docs/PLAYWRIGHT.md) — `web.browse` skill (headless Chromium for JS-rendered pages).
- [`docs/NANGO.md`](docs/NANGO.md) — OAuth + tool integrations gateway (Slack, Notion, GitHub, etc).
- [`docs/DESIGN_MD.md`](docs/DESIGN_MD.md) — Brand Foundation file format; voice + banned words injected into every Hermes response.
- [`docs/AGENTS.md`](docs/AGENTS.md) — Agent adapter contract & lifecycle.
- [`docs/SKILLS.md`](docs/SKILLS.md) — L2 intelligence layer, MCP, policy engine.
- [`docs/TOOLS.md`](docs/TOOLS.md) — MCP tool manifest format + invocation + probe.
- [`docs/INGESTION.md`](docs/INGESTION.md) — Document ingestion + upstream auto-pull operator playbook.
- [`docs/API.md`](docs/API.md) — Paperclip / agent / gbrain / skills HTTP contracts.
- [`docs/SCHEMA.md`](docs/SCHEMA.md) — Full Postgres data model + Qdrant collections.
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) — Anthropic, Qdrant, Supabase, Stripe, email.
- [`docs/STRIPE.md`](docs/STRIPE.md) — Stripe deep dive: webhook flow, schema, security rules.
- [`docs/GLOSSARY.md`](docs/GLOSSARY.md) — Every term defined once.
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — Every env var explained.

### Run & operate

- [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md) — Long-form Mac walkthrough + troubleshooting.
- [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — User onboarding (developer vs operator paths).
- [`docs/QA_CHECKLIST.md`](docs/QA_CHECKLIST.md) — Before-merge gate.
- [`docs/TESTING.md`](docs/TESTING.md) — Phased testing strategy.
- [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) — Logs, metrics, traces, audit log, cost.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Self-host + future hosted shape.
- [`docs/PAPERCLIP_REAL.md`](docs/PAPERCLIP_REAL.md) — The upstream paperclipai command centre at :3100, alongside our custom orchestrator at :3000.
- [`docs/HETZNER_DEPLOY.md`](docs/HETZNER_DEPLOY.md) — Beginner-shaped Hetzner Cloud + Coolify playbook for production deploy.
- [`docs/HOSTINGER_DEPLOY.md`](docs/HOSTINGER_DEPLOY.md) — Older reference for a Hostinger KVM 8 deploy (kept for archival; Hetzner is the recommended path).
- [`docs/SUPABASE_LOCAL.md`](docs/SUPABASE_LOCAL.md) — Test Supabase auth against your local stack.
- [`docs/STRIPE_LOCAL.md`](docs/STRIPE_LOCAL.md) — Test Stripe webhooks against your local stack.
- [`docs/BACKUP_RESTORE.md`](docs/BACKUP_RESTORE.md) — Volume snapshots, dumps, restore.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — Phases 0 → 8.

---

## 🤝 Contributing

This is currently a solo build by Kristian, but contributions will open as the project
matures. See `CONTRIBUTING.md` (coming soon).

**Working agreement for AI collaborators (Claude / Cursor / etc.):**
1. Read `docs/ARCHITECTURE.md` and `docs/GOAL_FIRST.md` before changing anything structural.
2. Never commit `.env` or any real secret.
3. Run `./infra/scripts/doctor.sh` before declaring a task done.
4. Prefer adding to `docs/` over leaving knowledge in chat.
5. Keep changes **modular** — swappable orchestrator, swappable agents, swappable memory.

---

## 📜 License

MIT — see [`LICENSE`](LICENSE).

---

> **Blank Collar** — because the most important work you do today should be
> the work your agents do *for* you, while you live your life.
