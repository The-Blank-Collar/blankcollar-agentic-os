# gbrain

The advanced memory layer for Blank Collar. Wraps Qdrant + Postgres into one
role-scoped, multi-modal memory API: facts, episodes, documents, conversations.

## Phase 0

Placeholder service that responds on `:8003`. Schema for memory metadata is
already laid down in `infra/docker/postgres/init.sql` (`brain.memory`).

## Phase 1 (next)

- `/remember` — write a memory (auto-embeds, stores vector in Qdrant, metadata in Postgres)
- `/recall`   — semantic search filtered by role / department / goal
- `/forget`   — soft-delete with audit log entry
- Embedding model configurable via `GBRAIN_EMBED_MODEL`
