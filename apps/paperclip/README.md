# Paperclip

Orchestrator + dashboard for the Blank Collar Agentic OS.

## Status: Phase 0 (placeholder)

For the groundwork phase, this folder ships a static `public/index.html` served
by an `nginx:alpine` container (see `docker-compose.yml`).

## What lands in Phase 2

- HTTP API (Node/TypeScript) for goals, runs, agents, audit log
- Goal-first dashboard UI
- Run queue + worker model
- Role-scoped controllers reading from `core.role_assignment`

## Local dev (today)

```bash
docker compose up -d paperclip
open http://localhost:3000
```
