# Hermes — workforce agent

General-purpose reasoning agent for The Blank Collar Agentic OS.
Implements the **Agent Adapter Contract** from [`docs/AGENTS.md`](../../docs/AGENTS.md)
and [`docs/API.md`](../../docs/API.md#agent-adapter-contract-l3).

## Status: Phase 3 — real (v0.1.0)

- `POST /run` — accepts a subtask, returns 202, runs in the background
- `GET /run/{id}` — current state (`running` / `succeeded` / `failed` / `cancelled`)
- `POST /run/{id}/cancel` — best-effort cooperative cancel
- `GET /healthz` — version, model, provider

The loop:

1. Recall recent memories from gbrain, scoped to the goal.
2. Compose a single LLM call with the system prompt + memories + subtask.
3. On success, write the result back to gbrain as an `episode` memory.

## Stack

Python 3.12 · FastAPI · pydantic v2 · `anthropic` SDK · httpx (gbrain client).

## LLM provider

Default: Anthropic Claude Sonnet (`HERMES_MODEL=claude-sonnet-4-6` by default).
Without `ANTHROPIC_API_KEY`, falls back to a deterministic "FAKE-LLM" so the
demo runs offline. A loud `WARNING` log line says when the fake is in effect.

## Layout

```
apps/hermes/
├── pyproject.toml
├── Dockerfile
├── app/
│   ├── main.py     # FastAPI app + adapter routes
│   ├── config.py   # env-driven settings
│   ├── models.py   # pydantic shapes (matches docs/API.md)
│   ├── llm.py      # AnthropicLLM + FakeLLM
│   ├── brain.py    # async gbrain client (recall/remember)
│   ├── runner.py   # the actual reasoning loop
│   └── state.py    # in-memory run state map (Phase 4 will persist)
└── tests/
    └── test_runner.py
```

## Run locally (via the full compose stack)

```bash
make bootstrap
curl -s http://localhost:8001/healthz | jq
```

## Tests

```bash
cd apps/hermes
pip install -e ".[dev]"
pytest -q
```
