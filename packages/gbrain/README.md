# gbrain

The Blank Collar memory layer. FastAPI service that wraps Qdrant + Postgres
into one role-scoped, multi-modal memory API: facts, episodes, documents,
conversations.

## Status: Phase 1 — real (v0.1.0)

Implements the contract from [`docs/API.md`](../../docs/API.md#gbrain-l1):

- `GET /healthz` → service status, version, embedding model
- `POST /remember` → write a memory (auto-embeds, vector → Qdrant, metadata → Postgres)
- `POST /recall` → semantic search filtered by `(org, department, goal, role)`
- `POST /forget` → delete + audit-log entry

## Layout

```
packages/gbrain/
├── pyproject.toml
├── Dockerfile
├── app/
│   ├── main.py        # FastAPI app + routes
│   ├── config.py      # env-driven settings
│   ├── models.py      # pydantic request/response (matches API.md)
│   ├── scope.py       # role-scope helpers + Qdrant filter builder ⚠ security-critical
│   ├── db.py          # asyncpg pool + queries
│   ├── vectors.py     # AsyncQdrantClient wrapper, lazy collection bootstrap
│   ├── embeddings.py  # Embedder protocol — OpenAI default, deterministic fake fallback
│   └── memory.py      # remember / recall / forget orchestration + audit
└── tests/
    └── test_scope.py  # 16 tests covering the scope filter
```

## Embeddings

Default: OpenAI `text-embedding-3-small` (1536 dims).

If `OPENAI_API_KEY` is empty, gbrain falls back to a **deterministic hash-based
fake embedder** of the same dimension. The service stays runnable offline; recall
quality is meaningless. A loud `WARNING` log line tells you when this is in effect.

To use real embeddings, set `OPENAI_API_KEY` in `.env`.

## Run locally

The service is wired into `docker-compose.yml`:

```bash
make up                # builds the image first time, then starts
make doctor            # confirms gbrain reports healthy at :8003/healthz
curl -s http://localhost:8003/healthz | jq
```

## Develop locally (without Docker)

```bash
cd packages/gbrain
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# Postgres + Qdrant must be running. Easiest:
docker compose up -d postgres qdrant

export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/blankcollar
export QDRANT_URL=http://localhost:6333

uvicorn app.main:app --reload --port 8003
```

## Tests

```bash
pytest -q
```

Currently covers the **scope filter** — the function whose mistakes would
let a `team_member` agent read an owner-only memory. Phase 1 ships 16 tests;
integration tests against real Postgres + Qdrant land alongside the first
agent that uses gbrain in Phase 3.

## Demo (manual, until Paperclip lands)

```bash
# write a fact
curl -s -X POST http://localhost:8003/remember \
  -H 'content-type: application/json' \
  -d @- <<'EOF'
{
  "kind": "fact",
  "title": "Pricing",
  "content": "Our Pro plan costs $29/mo, Team plan $99/mo.",
  "scope": {
    "org_id": "<paste from: SELECT id FROM core.organization WHERE slug='blankcollar-demo'>",
    "department_id": null,
    "goal_id": null,
    "role": "owner"
  }
}
EOF

# recall it
curl -s -X POST http://localhost:8003/recall \
  -H 'content-type: application/json' \
  -d '{
    "query": "how much does Pro cost?",
    "scope": { "org_id": "<same uuid>", "role": "owner" },
    "k": 5
  }' | jq
```

## What's next

Phase 1 closes the memory layer. Phase 2 brings Paperclip, which will be the
first real consumer of `/remember` and `/recall`.
