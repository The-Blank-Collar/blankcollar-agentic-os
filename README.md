# 🤖 The Blank Collar — Agentic OS

> **"Work is for bots. Life is for humans."**
>
> An AI Operating System so simple your grandma could run a company with it,
> and so powerful that a serious operator can scale a multi-agent business on top of it.

[![Status](https://img.shields.io/badge/status-groundwork-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()
[![Local-first](https://img.shields.io/badge/local--first-yes-brightgreen)]()
[![Docker](https://img.shields.io/badge/docker-ready-2496ED)]()

- 🌐 Future home: [www.blankcollar.ai](https://www.blankcollar.ai)
- 📧 Future agent inbox: `agent@blankcollar.ai`
- 👤 Owner: Kristian Kabashi — [www.theblankcollar.com](https://www.theblankcollar.com)

---

## 📖 Table of Contents

1. [What is Blank Collar?](#-what-is-blank-collar)
2. [Philosophy: Goal‑First, Not Agent‑First](#-philosophy-goalfirst-not-agentfirst)
3. [System Architecture](#-system-architecture)
4. [The Core Stack](#-the-core-stack)
5. [Repository Layout](#-repository-layout)
6. [Quick Start (Mac + Docker Desktop)](#-quick-start-mac--docker-desktop)
7. [Roles & Scoped Access](#-roles--scoped-access)
8. [The Company Brain](#-the-company-brain)
9. [QA & Debugging Checklist](#-qa--debugging-checklist)
10. [Roadmap](#-roadmap)
11. [Future Placeholders](#-future-placeholders)
12. [Documentation Map](#-documentation-map)
13. [Contributing](#-contributing)
14. [License](#-license)

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

| Layer            | Component         | Purpose                                                              | Status         |
|------------------|-------------------|----------------------------------------------------------------------|----------------|
| Command centre   | **Paperclip (real)** | Upstream `paperclipai` — Org chart, Heartbeats, Cost control, etc. | ✅ Native on Mac on :3100 — `make paperclip`  |
| Orchestration    | **Paperclip (legacy)** | Our custom Fastify orchestrator — Stripe webhook + Supabase auth + custom audit | ✅ Docker on :3000  |
| Workforce        | **Hermes Agent**  | General‑purpose reasoning agent (Anthropic Claude, fake fallback)    | ✅ runs locally (v0.1.0) |
| Workforce        | **OpenClaw**      | Tool‑action agent — `web.fetch` skill                                 | ✅ runs locally (v0.1.0) |
| Memory           | **gbrain**        | Advanced memory layer (semantic, episodic, factual; role‑scoped)     | ✅ runs locally (v0.1.0) |
| Vector store     | **Qdrant**        | Embeddings & similarity search                                       | ✅ runs locally |
| Relational store | **PostgreSQL**    | Structured state (goals, runs, users, audit log)                     | ✅ runs locally |
| Auth (future)    | **Supabase**      | Hosted auth + role management                                        | placeholder    |
| Payments (future)| **Stripe**        | Billing for hosted product                                           | placeholder    |
| Local platform   | **Docker Compose**| One command to run the entire stack on a Mac                         | ✅ ready       |

> Each component lives in its own folder under `apps/` or `packages/` and is **swappable**.

---

## 🗂 Repository Layout

```
blankcollar-agentic-os/
├── apps/
│   ├── paperclip/          # Orchestrator + dashboard (placeholder)
│   ├── hermes/             # Hermes agent adapter (placeholder)
│   └── openclaw/           # OpenClaw agent (placeholder)
├── packages/
│   ├── gbrain/             # Memory layer (placeholder)
│   └── shared/             # Shared types/utils (placeholder)
├── infra/
│   ├── docker/
│   │   └── postgres/       # init.sql — schemas for goals, runs, users, audit
│   └── scripts/
│       ├── bootstrap.sh    # First-run setup
│       ├── doctor.sh       # Health-check the local stack
│       └── reset.sh        # Wipe local volumes
├── docs/
│   ├── ARCHITECTURE.md
│   ├── GOAL_FIRST.md
│   ├── ROLES.md
│   ├── COMPANY_BRAIN.md
│   ├── LOCAL_SETUP.md
│   ├── QA_CHECKLIST.md
│   └── ROADMAP.md
├── .github/                # CI, issue/PR templates
├── docker-compose.yml      # The whole stack
├── .env.example            # All environment variables (copy to .env)
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

> Open `.env` in your editor. For Phase 0 (groundwork) you don't need to fill any
> external API keys — the data layer runs locally.

### 3. Start the stack

```bash
docker compose up -d
# …or, if you prefer the ergonomic wrappers:
make bootstrap
```

> Run `make help` to see every shortcut (`up`, `down`, `doctor`, `psql`, `logs`, `reset`, …).

This brings up:
- **PostgreSQL** on `localhost:5432`
- **Qdrant** on `localhost:6333` (REST) / `localhost:6334` (gRPC)
- **Paperclip placeholder** on http://localhost:3000
- **Hermes placeholder** on http://localhost:8001
- **OpenClaw placeholder** on http://localhost:8002
- **gbrain placeholder** on http://localhost:8003

### 4. Verify everything is healthy

```bash
./infra/scripts/doctor.sh
```

Expected output: ✅ for every service.

### 5. Open the placeholder dashboard

Visit **http://localhost:3000** — you should see the Paperclip placeholder page.

> 📚 Full local setup walkthrough (with troubleshooting):
> [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md)

### Stopping the stack

```bash
docker compose down            # stop containers, keep data
docker compose down -v         # stop AND wipe data (fresh slate)
./infra/scripts/reset.sh       # interactive reset with confirmation
```

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

| Phase | Theme                       | What lands                                                       |
|-------|-----------------------------|------------------------------------------------------------------|
| **0** | **Groundwork** *(now)*      | Monorepo, Docker stack, placeholders, docs                       |
| 1     | Real data layer             | gbrain v0, Qdrant collections, Postgres schemas, seed data        |
| 2     | Paperclip orchestrator      | Goal CRUD, run queue, agent registry, basic dashboard             |
| 3     | First real workforce        | Hermes adapter live, OpenClaw live, end‑to‑end goal demo          |
| 4     | Goal Command Centre         | Beautiful goal-first UX, dept views, role-scoped panels           |
| 5     | Intelligence layer          | Skills catalog, MCP tool registry, policy/permissions engine      |
| 6     | Auth & multi‑tenancy        | Supabase auth, org/department/user model, audit log               |
| 7     | Payments & onboarding       | Stripe billing, hosted onboarding, agent@blankcollar.ai inbox     |
| 8     | Public launch               | www.blankcollar.ai, hosted tier, marketplace of skills            |

> 📚 Full roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)

---

## 🧩 Future Placeholders

These are intentionally **not built yet**, but architected for from day one:

- **Stripe billing** — env vars + webhook route placeholder in `.env.example`
- **Supabase auth** — env vars + role mapping placeholder
- **Onboarding flow** — `apps/paperclip` will host the wizard
- **Email ingestion** (`agent@blankcollar.ai`) — webhook placeholder in roadmap
- **Skills marketplace / MCP registry** — `packages/` ready to host
- **Multi‑department orgs** — schema in `infra/docker/postgres/init.sql`

---

## 📚 Documentation Map

The full documentation set lives in [`docs/`](docs/). Use this map to find what you need:

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
- [`docs/ROLES.md`](docs/ROLES.md) — Role model + 3-layer enforcement.
- [`docs/COMPANY_BRAIN.md`](docs/COMPANY_BRAIN.md) — gbrain + Qdrant + Postgres design.
- [`docs/GRAPHITI.md`](docs/GRAPHITI.md) — Temporal knowledge graph (Neo4j) bridged from gbrain.
- [`docs/LANGGRAPH.md`](docs/LANGGRAPH.md) — Multi-agent dispatcher routing to Hermes + OpenClaw.
- [`docs/PLAYWRIGHT.md`](docs/PLAYWRIGHT.md) — `web.browse` skill (headless Chromium for JS-rendered pages).
- [`docs/NANGO.md`](docs/NANGO.md) — OAuth + tool integrations gateway (Slack, Notion, GitHub, etc).
- [`docs/DESIGN_MD.md`](docs/DESIGN_MD.md) — Brand Foundation file format; voice + banned words injected into every Hermes response.
- [`docs/AGENTS.md`](docs/AGENTS.md) — Agent adapter contract & lifecycle.
- [`docs/SKILLS.md`](docs/SKILLS.md) — L2 intelligence layer, MCP, policy engine.
- [`docs/API.md`](docs/API.md) — Paperclip / agent / gbrain / skills HTTP contracts.
- [`docs/SCHEMA.md`](docs/SCHEMA.md) — Full Postgres data model + Qdrant collections.
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) — Anthropic, Qdrant, Supabase, Stripe, email.
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
- [`docs/HOSTINGER_DEPLOY.md`](docs/HOSTINGER_DEPLOY.md) — End-to-end production deploy on a Hostinger KVM 8.
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
