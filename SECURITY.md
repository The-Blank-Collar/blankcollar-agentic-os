# Security

## Supported versions

Phase 0 (groundwork). No production deployments yet — security policy below applies to anyone running the local stack.

## Reporting a vulnerability

If you find a security issue, please **do not open a public issue**. Email the owner at `agent@blankcollar.ai` with:

- A description of the issue
- Reproduction steps
- The commit hash you tested against

You'll get an acknowledgement within 72 hours.

## Local-stack hygiene

Even though everything runs on your Mac, treat it as if it were public:

- Never commit `.env`. Only `.env.example`.
- Don't paste real API keys into placeholder files.
- The `bc_postgres` password defaults to `postgres` — change it before exposing the port outside `localhost`.
- The Qdrant API key is empty by default. Set `QDRANT_API_KEY` before binding `:6333` to a public interface.
- Don't `docker compose up` on a shared / company laptop without first reviewing the volume mounts.

## Future (hosted product)

When Phase 6+ ships:

- Supabase JWTs validated at the Paperclip edge
- Per-org encryption-at-rest keys
- Stripe webhook signature verification
- Audit log retention policy
