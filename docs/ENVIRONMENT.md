# Environment Variables

Reference doc for every variable in `.env.example`. The example file is the source of truth — this page explains *why* each one exists.

## Project metadata

| Variable        | Default                       | Notes                                                                |
|-----------------|-------------------------------|----------------------------------------------------------------------|
| `PROJECT_NAME`  | `blankcollar`                 | Used by services in metric labels, log prefixes, container names.    |
| `ENV`           | `local`                       | Free-form. Use `staging` or `production` later. Logged on startup.   |
| `LOG_LEVEL`     | `info`                        | One of `debug`, `info`, `warn`, `error`. Future apps will honour it. |
| `PUBLIC_DOMAIN` | `www.blankcollar.ai`          | Future-facing. Email links, OAuth callbacks, etc.                    |
| `AGENT_EMAIL`   | `agent@blankcollar.ai`        | Inbound address for the email-ingest pipeline (Phase 7).             |

## PostgreSQL

| Variable           | Default                                                          | Notes |
|--------------------|------------------------------------------------------------------|-------|
| `POSTGRES_USER`    | `postgres`                                                       | Local-only default. Change before exposing the port externally. |
| `POSTGRES_PASSWORD`| `postgres`                                                       | Same as above. Yes, the default is bad on purpose — it should never reach production unchanged. |
| `POSTGRES_DB`      | `blankcollar`                                                    | DB created on first boot via `init.sql`. |
| `POSTGRES_PORT`    | `5432`                                                           | Override if `5432` is already taken on your Mac. |
| `DATABASE_URL`     | `postgresql://postgres:postgres@postgres:5432/blankcollar`       | Convenience for apps that prefer a single URL. Note hostname is `postgres` (the compose service), not `localhost`. |

## Qdrant (vector store)

| Variable           | Default                       | Notes |
|--------------------|-------------------------------|-------|
| `QDRANT_HTTP_PORT` | `6333`                        | REST API. Dashboard is at `http://localhost:6333/dashboard`. |
| `QDRANT_GRPC_PORT` | `6334`                        | gRPC. |
| `QDRANT_API_KEY`   | *(empty)*                     | Set if you bind Qdrant to a public interface. Empty is fine for `localhost` only. |
| `QDRANT_URL`       | `http://qdrant:6333`          | In-cluster URL for service-to-service calls. |

## Paperclip (orchestrator + dashboard)

| Variable                | Default                             | Notes |
|-------------------------|-------------------------------------|-------|
| `PAPERCLIP_PORT`        | `3000`                              | Host port. The container always listens on 80. |
| `PAPERCLIP_AUTH_SECRET` | `replace-me-with-a-32-byte-hex-string` | Used to sign session/JWT cookies once Paperclip ships. Generate with `openssl rand -hex 32`. |

## Workforce agents (placeholders today)

| Variable           | Default | Notes |
|--------------------|---------|-------|
| `HERMES_PORT`      | `8001`  | Host port for Hermes adapter. |
| `HERMES_API_KEY`   | *(empty)* | Set when the real Hermes adapter ships in Phase 3. |
| `OPENCLAW_PORT`    | `8002`  | Host port for OpenClaw. |
| `OPENCLAW_API_KEY` | *(empty)* | Set when the real OpenClaw image ships in Phase 3. |

## gbrain (memory layer)

| Variable             | Default                       | Notes |
|----------------------|-------------------------------|-------|
| `GBRAIN_PORT`        | `8003`                        | Host port. |
| `GBRAIN_EMBED_MODEL` | `text-embedding-3-small`      | Default embedding model. Phase 1 will let you override per memory kind. |
| `GBRAIN_EMBED_DIM`   | `1536`                        | Must match the model. Mismatched dim = silently broken recall. |

## AI gateway — Portkey (required from Phase 2.1)

Every LLM call from paperclip / hermes / langgraph routes through Portkey for unified observability + cost tracking + key management. **Required at boot** — services refuse to start without these set.

| Variable                          | Default                       | Notes |
|-----------------------------------|-------------------------------|-------|
| `PORTKEY_API_KEY`                 | *(required)*                  | Your Portkey account key. Get one at https://app.portkey.ai/. |
| `PORTKEY_VIRTUAL_KEY_ANTHROPIC`   | *(required)*                  | Portkey virtual key pointing at your Anthropic credentials. Created in the Portkey dashboard → "Virtual Keys" → add provider Anthropic. |
| `PORTKEY_VIRTUAL_KEY_OPENROUTER`  | *(empty, optional)*           | Optional second virtual key — Portkey can also route to OpenRouter (hundreds of models). Per-call override via `provider: "openrouter"`. |
| `PORTKEY_BASE_URL`                | `https://api.portkey.ai/v1`   | Override only for self-hosted Portkey or testing. |

### Quick setup

1. Sign up at https://app.portkey.ai/.
2. **Settings → API Keys** → create a key. Copy it into `PORTKEY_API_KEY`.
3. **Virtual Keys → Add** → choose **Anthropic**, paste your `sk-ant-...`, give it a name. Copy the resulting virtual-key string (looks like `vk-anth-...`) into `PORTKEY_VIRTUAL_KEY_ANTHROPIC`.
4. *(Optional)* Repeat step 3 with provider **OpenRouter** + your OpenRouter key. Copy the resulting VK into `PORTKEY_VIRTUAL_KEY_OPENROUTER`.
5. `make up` — paperclip + hermes + langgraph will boot.

### Legacy

| Variable            | Default | Notes |
|---------------------|---------|-------|
| `ANTHROPIC_API_KEY` | *(empty)* | Read by graphiti (graphiti-core's internal LLM client). Not used by paperclip / hermes / langgraph after Phase 2.1 — they go through Portkey. Will be removed in Phase 2.1.b.2 follow-up. |
| `OPENAI_API_KEY`    | *(empty)* | Same — read by graphiti + gbrain (embeddings). |

## pgAdmin (optional, `--profile tools`)

| Variable          | Default                       | Notes |
|-------------------|-------------------------------|-------|
| `PGADMIN_EMAIL`   | `admin@blankcollar.local`     | Login for the pgAdmin UI. |
| `PGADMIN_PASSWORD`| `admin`                       | Local only. |
| `PGADMIN_PORT`    | `5050`                        | Host port. |

## Future phases (placeholders only)

### Supabase (Phase 6 — auth & roles)

| Variable                    | Notes |
|-----------------------------|-------|
| `SUPABASE_URL`              | Project URL. |
| `SUPABASE_ANON_KEY`         | Public anon key. Safe to ship to browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only.** Never ship to browser. |

### Stripe (Phase 7 — billing)

| Variable                  | Notes |
|---------------------------|-------|
| `STRIPE_SECRET_KEY`       | Server-side calls. |
| `STRIPE_PUBLISHABLE_KEY`  | Browser-side checkout. |
| `STRIPE_WEBHOOK_SECRET`   | Verify webhook signatures — always required. |

### Inbound email (Phase 7 — `agent@blankcollar.ai`)

| Variable                       | Notes |
|--------------------------------|-------|
| `SMTP_HOST` / `SMTP_PORT`      | Outbound. |
| `SMTP_USER` / `SMTP_PASS`      | Outbound. |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | HMAC-verifies inbound webhook payloads. |

## Rules of thumb

1. Add a new variable to `.env.example` *before* you reference it in code or compose. CI fails otherwise.
2. Defaults must be safe for `localhost` only. Never put real credentials in `.env.example`.
3. Every secret-shaped variable (anything ending `_KEY`, `_SECRET`, `_TOKEN`, `_PASSWORD`) defaults to empty.
4. Before adding a feature flag, ask whether it's really a flag or just a temporary `if` you'll forget to remove.
