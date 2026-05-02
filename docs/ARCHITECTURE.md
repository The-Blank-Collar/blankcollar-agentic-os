# Architecture — Blank Collar Agentic OS

## Guiding principles

1. **Local-first.** The entire system must run on a single Mac via Docker Compose, with no external dependencies for development.
2. **Goal-first.** The user-facing primitive is a *goal*, not an *agent*. Agents are an implementation detail of how a goal gets done.
3. **Swappable everything.** Orchestrator, agents, memory backend, vector store, auth provider — each component sits behind a clear interface.
4. **Role-scoped from day one.** Every read and every write carries `(org, department, role, goal)`. No "we'll add auth later."
5. **Persistent Company Brain.** Memory survives runs, agents, and even orchestrator restarts. New agents inherit it on hire.
6. **Auditable.** Every action that mutates state writes to `core.audit_log`.

## Layered model

```
┌──────────────────────────────────────────────────────────────┐
│  L5  Experience       Goal Command Centre (Phase 4)          │
├──────────────────────────────────────────────────────────────┤
│  L4  Orchestration    Paperclip — planner, queue, registry   │
├──────────────────────────────────────────────────────────────┤
│  L3  Workforce        Hermes · OpenClaw · future agents      │
├──────────────────────────────────────────────────────────────┤
│  L2  Intelligence     Skills · MCP tools · policy engine     │
├──────────────────────────────────────────────────────────────┤
│  L1  Memory           gbrain (semantic · episodic · facts)   │
├──────────────────────────────────────────────────────────────┤
│  L0  Storage          Postgres (state)  ·  Qdrant (vectors)  │
└──────────────────────────────────────────────────────────────┘
```

A request from L5 ("achieve goal X") cascades downward; data and memory updates flow back upward.

## Component contracts

### Paperclip (L4)

- **Inputs:** goals (CRUD), runs (start/cancel), agents (register).
- **Outputs:** plans, dispatched runs, status updates, audit entries.
- **Interface:** REST + websocket for live run telemetry. To be defined in Phase 2.

### Agents (L3)

Every agent — Hermes, OpenClaw, future — exposes the same minimum interface to Paperclip:

```
POST /run         { goal_id, run_id, input, scope: { org, dept, role } }
GET  /run/:id     -> { status, output?, error? }
POST /run/:id/cancel
```

Adapters live in `apps/<agent>/` and translate between this contract and whatever the underlying agent really speaks.

### gbrain (L1)

```
POST /remember   { kind, content, scope, metadata }   -> memory_id
POST /recall     { query, scope, k }                  -> [{ memory_id, score, content, metadata }]
POST /forget     { memory_id, reason }
```

`scope` always carries `(org_id, department_id?, goal_id?, role)` and is enforced both in the API and in the underlying queries.

### Storage (L0)

- **Postgres** holds state (`core.*`, `ops.*`, `brain.memory` metadata).
- **Qdrant** holds vectors. Each org gets its own collection per memory `kind`, named `{org_slug}__{kind}`.

## Data flow: a goal end-to-end

1. **Owner** creates goal *"Reach 1k newsletter signups by July"* via dashboard (L5).
2. Paperclip stores it in `ops.goal`, generates a plan (subtasks).
3. For each subtask, Paperclip selects an agent from `ops.agent` based on required skills.
4. Paperclip dispatches a `run` carrying the user's scope.
5. The agent calls `gbrain /recall` (scoped) to fetch context.
6. The agent executes — calling tools (L2) as needed — and reports output.
7. Paperclip writes the run result, the agent writes new memories via `gbrain /remember`.
8. `core.audit_log` records every state change with actor + role.

## Security & isolation

- Secrets only in `.env` — never committed.
- Each service runs in its own container; no host networking.
- The `bc_net` bridge network is the only path between services.
- Future hosted product: Supabase JWTs validated at the Paperclip edge before any L1–L4 call.

### Document ingestion (Phase 2.4)

Three context surfaces in the brain, each different by intent:

- **`ops.knowledge_doc`** — curated wiki entries (short, hand-written, link-rich).
- **`brain.memory`** — free-form one-liners ("Mira's birthday is Sept 12") + vectors in Qdrant.
- **`ops.document` + `ops.document_chunk`** — long-form ingested content (markdown files, URLs, future PDFs). Each doc is split by the deterministic paragraph-aware chunker into ~1500-char overlapping chunks. Per-org dedupe via `sha256(content_md)` makes re-ingestion safe + cheap; `force=true` replaces the prior copy. Keyword search (GIN tsvector) works today; vector search via gbrain is a planned follow-up.

The CLI surfaces this via `bc doc add`, `bc docs`, `bc docs search`, `bc doc <id>`, and `bc doc remove`. See `docs/INGESTION.md` for the operator walkthrough.

### Simulation + feedback (Phase 2.3)

Two related primitives that together let the operator verify-before-running and rate-after-running:

- **Simulation** — `POST /goals/:id/dispatch` and `/dispatch-all` accept `mode: "simulation"`. No real run is queued; instead `simulateDispatch()` (in `apps/paperclip/src/runs/simulate.ts`) classifies each subtask using `ops.skill.side_effects`. Read-only subtasks are reported as `would-execute`; write/external subtasks as `would-have-mutated`. Default-deny on unknown skills — safer to refuse than risk an unclassified execution. The audit log gets a single `run.simulate` row tagged on the goal.
- **Feedback** — `POST /runs/:id/feedback` writes a row to `ops.run_feedback` (rating 1-5, tags, free-form note). Multiple entries per run; the audit/level-up loop reads from this table when surfacing patterns ("Hermes consistently rated low on `wrong-tone` tag for vendor emails").
- **`ops.run.mode`** — every run row records whether it ran live or as a simulation (default `'live'`). Future "commit-this-simulation" flow can re-create runs with the cached plan; for now the column is informational.

### MCP tool gateway

Tools (Slack, GitHub, Postgres, web fetch, …) are exposed via the **Model Context Protocol** — JSON-RPC 2.0 over stdio (or HTTP/SSE/WS). YAML manifests in `packages/tools/manifests/` are the source of truth; on every Paperclip boot, `syncToolRegistry()` mirrors them into `ops.tool`. Each tool declares its `transport`, `target` command, env-var requirements, and input schema.

- **Discovery** — `GET /api/tools` and `GET /api/tools/:slug` return the registry.
- **Invocation** — `POST /api/tools/:slug/invoke` spawns the subprocess, runs the MCP handshake, returns the result. v0 supports stdio only; HTTP/SSE/WS return 501. Each call is recorded in `ops.tool_call_log` (input, output, latency_ms, is_error, stderr_tail).
- **Probing** — A non-blocking background probe runs after boot, exercising each enabled stdio tool's `initialize` handshake. Tools that fail are auto-disabled; manual `POST /api/tools/:slug/probe` re-enables them.
- **Direct invocation skips policy** — operator intent is implicit. Agent tool use goes through skills, which **do** evaluate the policy engine.
- **Each invocation is its own subprocess** — no connection pooling in v0. Cheap to reason about; the optimization comes when high-frequency tools justify it.

See `docs/TOOLS.md` for the manifest format and the operator workflow.

### AI gateway (Portkey)

Every LLM call from the TypeScript and Python services routes through **Portkey** — a single proxy that gives us logs, cost, latency, retries, and provider swaps in one place. Required at boot via `requireConfig()` (TS) / `require_runtime_config()` (Python). Anthropic credentials live in the Portkey dashboard, referenced by virtual keys; the codebase never sees raw provider keys after Phase 2.1.

- **Paperclip** — `apps/paperclip/src/llm/gateway.ts`. Single function `chatComplete(input)`. Default routes to Anthropic via `PORTKEY_VIRTUAL_KEY_ANTHROPIC`; per-call `provider: "openrouter"` routes through OpenRouter via `PORTKEY_VIRTUAL_KEY_OPENROUTER` for models Anthropic doesn't host.
- **Hermes / LangGraph** — `apps/hermes/app/llm.py`, `apps/langgraph/app/classifier.py`. Anthropic Python SDK with `base_url` + `x-portkey-*` default headers. Same wire format, same SDK; Portkey forwards.
- **Graphiti** — uses graphiti-core's internal LLM client (deferred to Phase 2.1.b.2 follow-up — needs upstream support or base-url override).
- **Local logging** — every paperclip call writes to `ops.llm_call_log` (org_id, run_id, provider, model, tokens_in/out, latency_ms, status, portkey_trace_id) so `bc llm` and the future console render cost/latency without leaving the system.

### Database scope helpers (`apps/paperclip/src/db.ts`)

Every Paperclip route that touches tenant data runs through one of two transaction wrappers. They are the single source of truth for who can read/write what.

- `withOrgScope(orgId, fn)` — binds the session GUC `app.org_id` for the duration of a transaction. Every RLS-enabled table has an `app_scope_org` policy that allows rows where `org_id = current_setting('app.org_id')`. Use this for **every user-facing request** — it's the tenant fence.
- `withSystemScope(fn)` — binds `app.system_scope = 'true'`. A sibling `app_system_scope` PERMISSIVE policy on every RLS-enabled table allows the row through whenever this flag is set. Use **only** for cross-org engine tasks: the worker claiming queued runs, the scheduler scanning every org for due routines, the bootstrap sweeping orgs, the health-counts probe. Never call from a request handler.

Anything that uses a bare `query()` or `tx()` without one of these helpers is a bug — it relies on the policy's permissive-on-unset branch (kept for backward compatibility) and will break the moment we tighten the policy in the strict-mode flip.

## What's intentionally out of scope for Phase 0

- Real agent code (Hermes/OpenClaw use placeholder containers).
- Authentication (no login screen yet — schema is ready, UI is not).
- Billing (Stripe placeholders only).
- Production deployment (the compose stack targets a single Mac).
