# FAQ

Beginner-first questions. If you have one that isn't here, open an issue with the `question` template.

## Is this for me?

### I've never written code. Will I be able to use this?
Yes — once Phase 4 (the Goal Command Centre) lands. Phase 0 is the engine room; Phase 4 is the steering wheel for non-coders. Until then, this repo is best for builders who want to set the foundation.

### I'm an engineer. Is this useful for me today?
Yes. You can run the local stack now, read the architecture docs, and start building the Phase 1 memory layer or Phase 2 orchestrator on top.

### Is this open source?
The OS is MIT-licensed. The hosted product (future) will be a paid service on top of the open-source core.

## What it is, what it isn't

### Is this another "AI agent framework"?
No. Frameworks ask you to think like a developer (spawn an agent, wire its tools, watch its terminal). Blank Collar asks you to think like a CEO (set a goal, review the result). The framework-layer exists, but it's a few clicks below the surface.

### How is this different from CrewAI / AutoGen / LangGraph / etc.?
See [`COMPARISON.md`](COMPARISON.md). Short version: those are libraries for building agents. We're an OS for running an agent-powered company. They are L3/L2 in our stack; we expose L4 and L5.

### Does it lock me into a model provider?
No. Phase 0 doesn't depend on any provider at all. Future phases will let you pick (Anthropic, OpenAI, local) per agent or per skill.

## Cost & privacy

### What does it cost to run?
Phase 0: nothing — Postgres, Qdrant, and nginx all run locally in Docker. Future phases will incur whatever model/API costs the agents themselves rack up; the OS itself stays free for self-hosters.

### Where does my data live?
Local Postgres + local Qdrant volumes inside Docker. Nothing leaves your machine until *you* connect a model API. The OS doesn't phone home.

### Do my agents have access to my private files / accounts?
Only what you explicitly give them. Skills are gated by the role policy (Phase 5). Until then, treat the local stack as single-tenant: anything you put in the Brain is visible to anything that connects.

## Setup

### I don't have a Mac. Will this still work?
Linux: yes, identical commands. Windows: WSL2 + Docker Desktop should work; we test on Mac so YMMV.

### Docker is asking for 8 GB of RAM. Is that real?
Postgres + Qdrant + four nginx containers are well under 1 GB combined. Set Docker Desktop's resource limit wherever you like above 2 GB.

### I see "port already allocated" on startup.
Another process is using one of `3000 / 5432 / 6333 / 6334 / 8001 / 8002 / 8003`. Either stop it or override the port in `.env` (e.g. `POSTGRES_PORT=5433`). See `LOCAL_SETUP.md#troubleshooting`.

## Roadmap & contributions

### When will Phase 1 / Phase 4 / etc. ship?
No public dates yet. The order is fixed (`ROADMAP.md`); the calendar isn't.

### Can I contribute?
Until the project opens publicly, contributions are by invitation. Watch the repo and `CONTRIBUTING.md` for the moment that flips.

### Will there be a hosted version?
Yes — Phase 7+. A free tier and paid tiers, billed via Stripe. Self-hosting will always remain a first-class option.

### Will there be a marketplace for skills / agents?
Phase 8. The infrastructure (`packages/skills`, MCP registry) is already on the roadmap.

## Concerns I should have

### What stops an agent from doing something destructive?
Three layers: (1) role-scoped API access, (2) the policy engine on every skill call (Phase 5), (3) the audit log catching anything that did happen. The default for any new skill is "human approves first."

### What if the model has a bad day and produces garbage?
Runs are reviewable. Plans are reviewable before execution. You can pause goals. You can fire agents. You can hard-revert by restoring the Postgres volume.

### What if I lose interest in a year?
Self-hosted, MIT-licensed, runs locally. Your goals, runs, and memory are in your own Postgres + Qdrant — exportable any time.
