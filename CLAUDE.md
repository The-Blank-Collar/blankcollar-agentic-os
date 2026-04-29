# CLAUDE.md — working agreement for AI collaborators

This file is read by Claude Code (and other AI agents) when they start a session in this repo. It encodes the conventions a new collaborator needs to know in the first 30 seconds.

## What this project is

**Blank Collar Agentic OS** — a local-first, goal-first agentic OS. Owner: Kristian Kabashi (`@theblankcollar`).

Source of truth for everything is in `docs/`:

- `docs/ARCHITECTURE.md` — layered model, contracts between components
- `docs/GOAL_FIRST.md` — the philosophy: users manage goals, not agents
- `docs/ROLES.md` — Owner / Department Lead / Team Member / Auditor / Agent
- `docs/COMPANY_BRAIN.md` — gbrain + Qdrant + Postgres memory model
- `docs/GRAPHITI.md` — temporal knowledge graph (Neo4j-backed) + gbrain bridge
- `docs/LANGGRAPH.md` — multi-agent dispatcher (classifier → hermes/openclaw)
- `docs/PLAYWRIGHT.md` — web.browse skill on OpenClaw (headless Chromium)
- `docs/NANGO.md` — OAuth + tool integrations gateway (400+ APIs)
- `docs/DESIGN_MD.md` — Brand Foundation runtime layer (Hermes voice + email lint)
- `docs/LOCAL_SETUP.md` — Mac + Docker Desktop walkthrough
- `docs/QA_CHECKLIST.md` — gates before merging
- `docs/ROADMAP.md` — phases 0 → 8

**Read these before changing anything structural.** Don't reinvent.

## Hard rules

1. **Goal-first.** Every new user-facing feature must surface a goal/outcome, not plumbing. If it surfaces plumbing, gate it behind an "advanced" panel. (See `docs/GOAL_FIRST.md`.)
2. **Role-scoped from day one.** Every read/write carries `(org, department, role, goal)`. Never add an endpoint that ignores the scope. (See `docs/ROLES.md`.)
3. **Swappable components.** Orchestrator, agents, memory, vector store, auth — each behind a clear contract. Don't tightly couple.
4. **Audit everything.** Mutations write to `core.audit_log`.
5. **No secrets in commits.** Ever. `.env` is gitignored — only `.env.example` is tracked.

## Local commands you'll need

```bash
make bootstrap     # first-run: brings the whole stack up
make doctor        # health-check (must exit 0 before declaring "done")
make psql          # Postgres shell
make logs          # tail all service logs
make reset         # interactive wipe
```

The full list: `make help`.

## Quality gate before declaring a task done

1. `./infra/scripts/doctor.sh` exits 0.
2. `docker compose config -q` exits 0.
3. Every `${VAR}` in `docker-compose.yml` is also in `.env.example`.
4. The relevant section of `docs/QA_CHECKLIST.md` is satisfied.
5. README / docs updated if user-visible behaviour changed.

If any of these fails, the task is **not** done.

## Code style cues

- Indent: 2 spaces (4 for Python and shell). Enforced by `.editorconfig` + `.gitattributes`.
- Default to writing **no** comments. Only add a comment when the *why* is non-obvious.
- Don't introduce abstractions for hypothetical future requirements.
- Prefer editing existing files over creating new ones.
- Don't write `*.md` planning/decision/analysis docs unless explicitly asked.

## Git workflow

- Develop on a feature branch; PR into `main`.
- Conventional Commits encouraged.
- Don't force-push `main`.
- CODEOWNERS auto-requests review from `@theblankcollar`.

## Phase you're (probably) in

Check `docs/ROADMAP.md`. Phases 0–3 are complete (groundwork → gbrain → paperclip → real workforce). Upstream OSS integrations landed in this order: **Graphiti** → **LangGraph** → **Playwright** → **Nango** → **design.md (Brand Foundation)**. Only **E2B** (secure sandboxes via Firecracker) is left — deferred until the Hostinger VPS deploy because it needs `/dev/kvm`.

## When stuck

1. `docker compose down -v && make bootstrap` — clean slate, fixes most local weirdness.
2. `docs/LOCAL_SETUP.md#troubleshooting` — has the common failure modes.
3. If a fix would change a contract in `docs/ARCHITECTURE.md`, propose the doc change *first*.
