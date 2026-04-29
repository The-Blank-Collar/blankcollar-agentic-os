# LangGraph Dispatcher

Multi-agent orchestrator built on
[LangGraph](https://github.com/langchain-ai/langgraph). It speaks the same
**Agent Adapter Contract** as Hermes and OpenClaw (`/run`, `/run/{id}`,
`/run/{id}/cancel`, `/healthz`), so Paperclip can dispatch to it like any
other workforce kind. Internally, it classifies the subtask and routes to
Hermes (reasoning) or OpenClaw (web/tool actions) — eventually looping for
multi-step plans.

## Why this exists

Today's Paperclip dispatches each subtask to a single agent kind chosen by
the plan generator. That works for simple flows but doesn't scale to:
- "Summarise this URL **and then** decide whether it's worth replying to"
- "Search → fetch the top 3 → synthesise → draft email"

LangGraph runs a stateful graph — the dispatcher classifies, calls an
agent, captures the result, and (with `LANGGRAPH_MAX_CYCLES > 1`) can
classify again with the result in context. Cycles are hard-bounded so
loops can't run away.

## Architecture

```
                ┌──────────────┐
   Paperclip ──►│  /run        │◄──── Agent Adapter Contract
                │ (langgraph)  │
                └──────┬───────┘
                       │ background asyncio task
                       ▼
                ┌──────────────────────────────┐
                │  LangGraph compiled graph    │
                │                              │
                │  classify ─► route           │
                │     ▲          │             │
                │     │      ┌───┴─────┐       │
                │     │      ▼         ▼       │
                │     │   hermes    openclaw   │
                │     │      │         │       │
                │     │      └────┬────┘       │
                │     │           ▼            │
                │     │       capture          │
                │     │           │            │
                │     │   cycles<MAX?          │
                │     │       │   │            │
                │     │      yes  no           │
                │     └───────┘    └► finish   │
                └──────────────────────────────┘
```

Hermes + OpenClaw are reached via the existing adapter HTTP endpoints —
no special integration needed on their side.

## Classifier

The router decides between **hermes**, **openclaw**, or **finish** for
each cycle. It works in two modes:

| Mode | Trigger | Behaviour |
|---|---|---|
| **LLM** | `NEXOS_API_KEY` (preferred) / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` is set | Sends subtask to a small completion; expects exactly one word back |
| **Keyword** | No API key | Pure-function pattern matching: URLs and `email`/`search`/`research` verbs → openclaw; reasoning verbs → hermes; default → hermes |

The keyword fallback is fully tested (17 unit tests) — even with no LLM
configured, routing is deterministic and predictable.

## API

Identical shape to Hermes/OpenClaw — see
[`docs/AGENTS.md`](AGENTS.md#agent-adapter-contract) and
[`docs/API.md`](API.md). Differences:

- `GET /healthz` returns an extra `downstream` field reporting whether
  Hermes / OpenClaw / gbrain are reachable.
- The `output.history` of a successful run lists every downstream call
  the dispatcher made in order.

## How Paperclip uses it

`apps/paperclip/src/queue/registry.ts` registers `langgraph` as a kind
alongside `hermes` and `openclaw`. To dispatch a subtask via the
dispatcher, set `subtask.agent_kind = "langgraph"` in the plan output.

The default plan generator still routes URL-bearing goals directly to
OpenClaw → Hermes → Hermes (no LangGraph). To use LangGraph, edit the
plan in the dashboard or generate one with `agent_kind: langgraph` for
the steps that should use it.

## Bring it up

```bash
make bootstrap
make doctor
```

You should see two new green lines:
- `bc_langgraph healthy`
- `LangGraph responding (http://localhost:8005/healthz)`

Test the classifier directly:
```bash
curl -s http://localhost:8005/healthz | jq
# { "ok": true, "version": "0.1.0", "kind": "langgraph",
#   "classifier_provider": "none",
#   "downstream": { "hermes": true, "openclaw": true, "gbrain": true } }
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `LANGGRAPH_PORT` | 8005 | Host port |
| `LANGGRAPH_URL` | `http://langgraph:80` | In-cluster URL Paperclip uses |
| `LANGGRAPH_CLASSIFIER_MODEL` | `claude-sonnet-4-6` | Used when ANTHROPIC_API_KEY is set |
| `LANGGRAPH_CLASSIFIER_MAX_TOKENS` | 200 | Cap on classifier completion size |
| `LANGGRAPH_MAX_CYCLES` | 4 | Hard bound on graph loops per run |
| `LANGGRAPH_POLL_INTERVAL_S` | 0.5 | How often the dispatcher polls downstream agents |
| `LANGGRAPH_POLL_TIMEOUT_S` | 180 | Max time to wait for a single downstream run |

LLM keys are reused from the existing stack: `NEXOS_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.

## Deferred to later sessions

- Multi-cycle loops in the default plan generator (right now we run one
  classify → execute pass per `/run`; multi-pass requires a planner that
  decides when to loop)
- Persistent state via LangGraph's checkpointer (today the run state is
  in-memory only; restarts lose in-flight runs)
- Streaming run telemetry to Paperclip via WebSocket
- Agent-as-tool: letting Hermes call OpenClaw mid-reasoning via LangGraph's
  tool-use pattern instead of going back through the dispatcher
