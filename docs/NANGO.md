# Nango — OAuth + tool integrations gateway

[Nango](https://www.nango.dev) is a self-hosted gateway that handles
OAuth flows, token storage, and proxied API calls for **400+ external
services** — Slack, Notion, GitHub, HubSpot, Google Workspace,
Salesforce, Linear, Stripe (the API, not the webhook), and on. Lets
agents call any of them through a single proxy without bespoke per-service
auth code.

## What runs

Three new containers:

| Container | Image | Role |
|---|---|---|
| `bc_nango_db` | `postgres:16-alpine` | Dedicated Postgres (separate from our shared `bc_postgres`) |
| `bc_nango_redis` | `redis:7.2.4` | Queue + cache |
| `bc_nango` | `nangohq/nango-server:hosted` | API + Connect UI |

Ports exposed on host:
- `:3003` — Nango API (the `/proxy` endpoint OpenClaw calls)
- `:3009` — Connect UI (where you wire up integrations interactively)

> Nango ships only an `amd64` image. On Apple Silicon, Docker Desktop
> emulates via Rosetta. Slower first-run but works.

## First-run setup (~5 min)

After `make bootstrap`:

1. **Open the Connect UI**: http://localhost:3009
2. **Find your secret key**: Settings → Environment Settings → Secret Key.
   Copy it.
3. **Paste into `.env`**:
   ```
   NANGO_SECRET_KEY=<paste here>
   ```
4. **Restart OpenClaw** so it picks up the key:
   ```bash
   docker compose restart openclaw
   ```
5. **Add an integration** in the Nango UI (e.g. Slack):
   - Integrations tab → Add Integration → pick provider
   - Fill in the OAuth client ID/secret from the provider's dev portal
   - Click Save
6. **Create a connection** (per-customer auth):
   - Connections tab → Add Test Connection → pick the integration
   - Choose a `connection_id` (e.g. `acme-slack`) — agents reference this
   - Walk through the OAuth flow

Once a connection exists, agents can invoke it via the `nango.invoke` skill.

## How agents call it

OpenClaw skill: `nango.invoke`. Input fields:

| Field | Required | Notes |
|---|---|---|
| `provider_config_key` | yes | Integration name in Nango (e.g. `"slack"`). |
| `connection_id` | yes | Which connection to use (per-customer). |
| `endpoint` | yes | Provider endpoint, path or full URL (e.g. `"/api/chat.postMessage"`). |
| `method` | no | `GET` (default), `POST`, `PUT`, `PATCH`, `DELETE`. |
| `params` | no | Query string dict. |
| `headers` | no | Extra request headers. Auth/routing headers are stripped. |
| `body` | no | JSON body for POST/PUT/PATCH. |

Example subtask:

```json
{
  "subtask": {
    "title": "Post Friday digest to #marketing",
    "agent_kind": "openclaw",
    "input": {
      "skill": "nango.invoke",
      "provider_config_key": "slack",
      "connection_id": "acme-slack",
      "endpoint": "/api/chat.postMessage",
      "method": "POST",
      "body": {
        "channel": "#marketing",
        "text": "Friday digest..."
      }
    }
  }
}
```

Result is written to `gbrain` as a `conversation` memory with the response
status, body preview, and the full call metadata.

## What gets persisted

- **Nango DB** (`bc_nango_db_data` volume) — OAuth tokens, integration
  configs, connection state. Survives restarts.
- **gbrain** — every `nango.invoke` result is recorded as a memory so
  Hermes can recall what was just sent / received.
- **`core.audit_log`** — Paperclip's worker writes a `run.succeeded` /
  `run.failed` entry for every dispatch.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `NANGO_SERVER_PORT` | 3003 | Public API port |
| `NANGO_CONNECT_UI_PORT` | 3009 | Dashboard / OAuth flow UI |
| `NANGO_DB_*` | nango/nango/nango | Internal Postgres credentials |
| `NANGO_ENCRYPTION_KEY` | dev placeholder | **Change this in production.** 32-byte base64. Generate: `openssl rand -base64 32`. Keep stable across restarts or stored connections become unreadable. |
| `NANGO_FLAG_AUTH_ENABLED` | false | Flip to `true` + set the dashboard credentials before exposing publicly. |
| `NANGO_DASHBOARD_USERNAME/PASSWORD` | admin/admin | Only used when auth is enabled. |
| `NANGO_URL` | `http://nango:3003` | In-cluster URL OpenClaw uses |
| `NANGO_SECRET_KEY` | empty | The runtime key OpenClaw uses for `/proxy` calls. Empty disables `nango.invoke` with a clear error. |

## Safety

- `NANGO_FLAG_AUTH_ENABLED=false` is the default — safe for `localhost` only.
  Before exposing the API to anything else, flip the flag and set credentials.
- The `nango.invoke` skill strips client-supplied auth/routing headers
  (`Authorization`, `Provider-Config-Key`, `Connection-Id`) before sending
  to Nango — agents can't impersonate other connections.
- `endpoint` validation rejects CRLF injection and over-long inputs.

## Tests

`apps/openclaw/tests/test_nango.py` covers the validation paths:
- Endpoint validation (path / full URL / empty / CRLF / too long)
- No-secret-key path returns a helpful error
- Missing provider/connection rejected
- Unsupported HTTP method rejected

## Deferred to later sessions

- Webhook ingestion — Nango can fire when a Slack message arrives, etc.
  Not yet wired into our `email-ingest`-style sidecar.
- Nango Sync — the periodic-pull syncs that mirror provider data into our
  Postgres. Useful but a Phase-7+ thing.
- Per-org connection isolation — currently all agents see all connections.
  Phase 6 will scope connection IDs per `(org, department)`.
