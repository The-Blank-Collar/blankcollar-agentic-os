# Paperclip

Orchestrator + dashboard for The Blank Collar Agentic OS.

## Status: Phase 2 — real (v0.1.0)

- HTTP API matching `docs/API.md` (goals, runs, agents, audit, plan/dispatch)
- Server-rendered, htmx-driven dashboard at `/`
- In-process queue worker that picks queued runs and dispatches to a built-in
  **fake agent** (until Phase 3 brings real Hermes / OpenClaw)
- Fake agent writes an `episode` memory to gbrain on success, proving L1↔L4 wiring
- Audit-log entries on every state change

## Stack

Node 22 · TypeScript · Fastify 5 · pg · Zod · htmx (CDN) · vitest · pino-pretty.

## Layout

```
apps/paperclip/
├── package.json
├── tsconfig.json
├── eslint.config.js
├── vitest.config.ts
├── Dockerfile          # multi-stage Node 22 image
├── src/
│   ├── index.ts        # bootstrap (Fastify + worker + signal handlers)
│   ├── config.ts       # env-driven settings
│   ├── schemas.ts      # Zod schemas (Scope, Goal, Run, Agent, Audit)
│   ├── db.ts           # pg pool + tx helper
│   ├── audit.ts        # core.audit_log writer
│   ├── scope.ts        # caller scope resolver (stub: owner of demo org)
│   ├── plan.ts         # v0 plan generator (stub subtasks)
│   ├── routes/
│   │   ├── health.ts   # GET /api/health
│   │   ├── goals.ts    # CRUD + plan + dispatch
│   │   ├── runs.ts     # GET / cancel
│   │   ├── agents.ts   # CRUD (hire, update, fire)
│   │   ├── audit.ts    # GET /api/audit
│   │   └── ui.ts       # / and /goals/:id (server-rendered HTML)
│   └── queue/
│       ├── worker.ts   # polls ops.run for queued, dispatches, marks done/failed
│       └── fake-agent.ts # stand-in agent that writes an episode memory
└── test/
    ├── plan.test.ts
    └── schemas.test.ts
```

## Run locally (via the full compose stack)

```bash
make bootstrap
make doctor
open http://localhost:3000
```

## Develop locally (hot-reload, without Docker)

```bash
cd apps/paperclip
npm install

# Postgres + Qdrant + gbrain need to be running. Easiest:
docker compose up -d postgres qdrant gbrain

export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/blankcollar
export GBRAIN_URL=http://localhost:8003
export PAPERCLIP_INTERNAL_PORT=3000

npm run dev
# open http://localhost:3000
```

## Tests

```bash
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

## End-to-end demo (manual)

1. `make bootstrap` — full stack up.
2. Open http://localhost:3000.
3. Type a goal: *"Reach 1,000 newsletter subscribers by July."*
4. Click into the goal → **Generate plan** (creates 3 stub subtasks).
5. **Dispatch** the first subtask → watch the run go `queued → running → succeeded`.
6. Confirm an episode memory was written:
   ```bash
   docker exec bc_postgres psql -U postgres -d blankcollar \
     -c "SELECT id, kind, title FROM brain.memory ORDER BY created_at DESC LIMIT 5;"
   ```
7. Confirm audit-log entries:
   ```bash
   docker exec bc_postgres psql -U postgres -d blankcollar \
     -c "SELECT action, target_type, created_at FROM core.audit_log ORDER BY created_at DESC LIMIT 10;"
   ```

## What's next

Phase 3: replace `fake-agent.ts` with real Hermes / OpenClaw adapter calls.
The adapter contract is in `docs/AGENTS.md`.
