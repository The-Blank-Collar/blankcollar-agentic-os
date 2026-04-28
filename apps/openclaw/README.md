# OpenClaw — workforce agent

Tool / web-action agent for The Blank Collar Agentic OS.
Implements the **Agent Adapter Contract** from [`docs/AGENTS.md`](../../docs/AGENTS.md).

## Status: Phase 3 — real (v0.1.0)

Endpoints (per `docs/API.md`):
- `POST /run` · `GET /run/{id}` · `POST /run/{id}/cancel` · `GET /healthz`

## Skills shipped in v0

| Skill         | Inputs                          | Behaviour                                                                                              |
|---------------|---------------------------------|--------------------------------------------------------------------------------------------------------|
| `web.fetch`   | `url`                           | Politely fetches a URL, extracts visible text, writes a `document` memory to gbrain.                   |
| `web.search`  | `query`, `max_results?`         | Searches the web (Oxylabs AI Studio if `OXYLABS_API_KEY` set; DuckDuckGo otherwise) and stores results. |

The skill is selected by `subtask.input.skill`. If a `url` is present, `web.fetch`
is the default. If a `query` is present, `web.search` is the default.

## Search providers

- **Oxylabs AI Studio** — production default on Hostinger, where `OXYLABS_API_KEY`
  is set. The Oxylabs response shape is normalised into `{title, url, snippet}`
  so Hermes always sees the same shape.
- **DuckDuckGo Instant Answer** — anonymous fallback when no Oxylabs key is set.
  Low rate limit, fewer results, but keeps the demo runnable offline.

## Politeness controls

- 10 second default timeout, configurable
- 1.5 MB max content download, configurable
- Declared user agent: `BlankCollar-OpenClaw/0.1 (+https://www.blankcollar.ai)`
- Refuses non-`http(s)` schemes and IP literals on private / loopback / link-local / reserved ranges (incl. AWS IMDS)
- HTML is parsed with `selectolax`; `<script>`, `<style>`, `<noscript>` stripped before extraction

## Stack

Python 3.12 · FastAPI · pydantic v2 · httpx · selectolax (lxml-fast HTML).

## Layout

```
apps/openclaw/
├── pyproject.toml
├── Dockerfile
├── app/
│   ├── main.py     # FastAPI app + adapter routes
│   ├── config.py   # env-driven settings (timeouts, caps, UA)
│   ├── models.py   # pydantic shapes
│   ├── fetch.py    # web.fetch skill (safety + extraction)
│   ├── brain.py    # gbrain client (writes documents)
│   ├── runner.py   # skill router
│   └── state.py    # in-memory run state
└── tests/
    └── test_fetch_safety.py
```

## What's next

Phase 5 will move skills into a registry (`packages/skills/`) so any agent —
not just OpenClaw — can call them through the policy gate. Future skills:
`browser.click`, `email.send`, `file.read`.
