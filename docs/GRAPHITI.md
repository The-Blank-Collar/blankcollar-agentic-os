# Graphiti — temporal knowledge graph

Graphiti adds a **temporal knowledge graph** layer on top of `gbrain`. Where
`gbrain` answers *"what facts have we stored?"* via vector search, Graphiti
answers *"how have facts evolved over time, and what entities/relationships
connect them?"* — backed by Neo4j and built around the
[graphiti-core](https://github.com/getzep/graphiti) library.

## Architecture

```
gbrain /remember (your code)
        │
        ├─► Postgres + Qdrant   (existing — vector + structured store)
        │
        └─► Graphiti /add       (new — best-effort fan-out)
                  │
                  └─► Neo4j     (graph store)
```

The bridge is **fire-and-forget**: `gbrain /remember` returns immediately and
graphiti ingests the episode in the background. If graphiti is down or the
LLM key is missing, `gbrain` still succeeds normally — just no graph entry.

## Services

| Container | Image | Port (host) | Role |
|---|---|---|---|
| `bc_neo4j` | `neo4j:5.26.2` | 7474 (HTTP), 7687 (Bolt) | Graph backend |
| `bc_graphiti` | `blankcollar/graphiti:0.1.0` | 8004 | FastAPI wrapper around `graphiti-core` |

Volumes: `bc_neo4j_data`, `bc_neo4j_logs`.

## API

### `GET /healthz`
Returns `{ ok, version, backend, backend_ok, llm_provider }`.
`llm_provider` is one of `openai`, `nexos`, `anthropic`, or `none`.

### `POST /add`
Adds a temporal episode.
```json
{
  "name": "Pricing change",
  "body": "We bumped the Pro plan from $19 to $29.",
  "scope": { "org_id": "...", "department_id": null, "goal_id": null, "role": "owner" },
  "occurred_at": "2026-04-29T12:00:00Z",
  "source": "gbrain",
  "metadata": {}
}
```
Response when no LLM is configured:
```json
{ "skipped": true, "reason": "no_llm_configured", "episode_id": null, "nodes_added": 0, "edges_added": 0 }
```
With an LLM, graphiti extracts entities + relationships and returns counts.

### `POST /search`
```json
{ "query": "what's our pricing?", "scope": { "org_id": "..." }, "k": 10 }
```
Returns a list of `{ fact, score, source_episode_id, valid_from, valid_to }`.

## Scoping

Each `(org_id, department_id?, goal_id?)` tuple gets its own `group_id` inside
Neo4j (e.g. `<org-uuid>|dept:<dept-uuid>|goal:<goal-uuid>`). Graphiti
queries are filtered by group, so memories from different orgs / departments
are never mixed even though they share the same Neo4j instance.

Role is a runtime check (gbrain enforces it) and does **not** affect the
group_id. Two callers with the same scope but different roles see the same
graph data — graphiti's `group_id` is for partition isolation, not RBAC.

## LLM provider precedence

Graphiti uses an LLM to extract entities + relationships per episode. The
service picks the first available, in this order:

1. `OPENAI_API_KEY`
2. `NEXOS_API_KEY` (Hostinger AI gateway)
3. `ANTHROPIC_API_KEY`
4. None → `/add` returns `skipped: true`

Set whichever key you have in `.env`. The service starts and serves
`/healthz` regardless — only `/add` and `/search` need the key to do real work.

## Bring it up

```bash
make bootstrap
make doctor
```

Doctor should show:
```
✅ bc_neo4j healthy
✅ bc_graphiti healthy
✅ Neo4j responding (http://localhost:7474)
✅ Graphiti responding (http://localhost:8004/healthz)
```

Open Neo4j Browser at http://localhost:7474 (user `neo4j`, password `password`)
to inspect the graph directly.

## Verifying the bridge

After creating a memory through the dashboard or API, check graphiti's view of it:

```bash
# How many episodes have been ingested?
curl -fsS http://localhost:8004/healthz | jq

# Search the graph (LLM key required for meaningful results)
curl -fsS -X POST http://localhost:8004/search \
  -H 'content-type: application/json' \
  -d '{
    "query": "what facts do we know about pricing?",
    "scope": { "org_id": "<your-org-uuid>", "role": "owner" },
    "k": 10
  }' | jq
```

## Deferred to later sessions

- Reading graphiti's results back into `gbrain /recall` (cross-store query)
- Visualisation of the graph in the Paperclip dashboard
- Per-department graph isolation in the UI
- Backups / snapshot strategy for Neo4j
