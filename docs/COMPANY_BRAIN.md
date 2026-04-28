# The Company Brain

The Company Brain is the persistent, role-scoped memory that every agent in Blank Collar shares. It is the single biggest reason a new agent hired tomorrow can be productive on day one — it inherits everything the company has ever learned.

## Composition

```
gbrain (API)
   │
   ├─► Postgres   →  brain.memory (metadata, scoping, audit trail)
   └─► Qdrant     →  embedding vectors, one collection per memory kind
```

Postgres is the **source of truth** for what a memory is and who can see it. Qdrant is the **search index** that lets us recall memories by meaning, not by keyword.

## Memory kinds (`brain.memory_kind`)

| Kind            | Example                                                                           |
|-----------------|-----------------------------------------------------------------------------------|
| `fact`          | "Our pricing is $29/mo for the Pro plan."                                         |
| `episode`       | "On Apr 12, the Sales agent emailed 14 leads and 3 replied."                      |
| `document`      | "Brand voice guide.pdf — embedded chunk 7."                                       |
| `conversation`  | "Slack thread with the support agent about refund policy."                        |

## Scoping (the most important part)

Every memory is written with:

- `org_id` (required)
- `department_id` (often)
- `goal_id` (when relevant)
- `visible_to: role_kind[]` (defaults to `[owner, department_lead]`)

Every recall passes the caller's `(org, department, goal, role)`. The query filters Postgres metadata first, then sends the surviving `vector_ref` IDs to Qdrant for similarity search.

This means an intern-level `team_member` agent recalling "what's our brand voice?" gets the marketing-scoped facts visible to its role — not the founder's private negotiation notes.

## Why both stores?

- **Postgres alone** can't do semantic recall well — vector indexes there don't match Qdrant for speed at scale.
- **Qdrant alone** can't enforce role-scoped joins efficiently — and it isn't a system of record.
- **Together** we get fast semantic recall *and* strict role enforcement *and* a durable audit trail.

## The contract (Phase 1 will implement)

```
POST /remember
  body: { kind, title?, content, scope, visible_to?, metadata? }
  → { memory_id }

POST /recall
  body: { query, scope, k=10, kinds?, min_score? }
  → [{ memory_id, score, content, metadata }]

POST /forget
  body: { memory_id, reason }
  → { ok: true }
```

`scope = { org_id, department_id?, goal_id?, role }`.

## What ships in Phase 0

- `brain.memory` table is in `init.sql`.
- The placeholder gbrain container responds on `:8003` so the dependency graph in compose is correct.
- Embeddings are not yet computed — `vector_ref` will be `NULL` until Phase 1.

## Operational rules

1. Never write a memory without a scope. The API will reject it.
2. Never recall a memory without a scope. The API will reject it.
3. `forget` is soft-delete by default; hard-delete is owner-only.
4. Every `/remember` and `/forget` writes to `core.audit_log`.
