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

## What's intentionally out of scope for Phase 0

- Real agent code (Hermes/OpenClaw use placeholder containers).
- Authentication (no login screen yet — schema is ready, UI is not).
- Billing (Stripe placeholders only).
- Production deployment (the compose stack targets a single Mac).
