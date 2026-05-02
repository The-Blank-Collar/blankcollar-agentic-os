# MCP tool registry

YAML manifests in `packages/tools/manifests/{shared,company,personal}/` are the source of truth for the agentic OS's tool catalog. On every Paperclip boot, `syncToolRegistry()` (in `apps/paperclip/src/tools/registry.ts`) walks the directory, validates each file against the `ToolManifest` Zod schema, and upserts shared tools into `ops.tool` with `org_id = NULL` (visible to every org via the policy's NULL-pass branch).

A "tool" here means a **Model Context Protocol** server an agent can call — distinct from a "skill" (which is a higher-level domain action like `email.send` that may or may not be backed by a tool).

## Resolution order

1. `PAPERCLIP_TOOLS_DIR` env var (absolute path) — used in tests
2. `/app/packages/tools/manifests` — inside the container
3. `packages/tools/manifests/` relative to CWD
4. `../../packages/tools/manifests/` — for `npm run dev` from `apps/paperclip/`

## Manifest format

```yaml
id: web.fetch                         # unique slug; convention: dotted (provider.action)
version: 1                            # integer; bump on breaking input-schema changes
scope: shared                         # shared | company | personal
name: Fetch a web URL                 # human-friendly title
description: |                        # optional; markdown allowed
  Multi-line description shown in `bc tool <slug>` and the future console.
transport: stdio                      # stdio | http | sse | websocket
target: npx @modelcontextprotocol/server-fetch   # command (stdio) or URL (http/ws)
env_keys:                             # env-var names the tool needs at invoke time;
  - PGHOST                            # values come from the host env, never the manifest
  - PGPASSWORD
input_schema:                         # JSON-Schema-shaped object; the v0 client doesn't
  url:                                # validate strictly yet, but the registry stores it
    type: string                      # so the future console can render input forms
    format: uri
    required: true
  method:
    type: string
    enum: [GET, HEAD]
    default: GET
```

## Field semantics

| Field | Required | Notes |
|---|:---:|---|
| `id` | ✓ | Stable identifier. Renaming = a new tool. Convention: lowercase, dot-separated. |
| `version` | ✓ | Integer ≥ 1. Multiple versions of the same `id` coexist; the latest wins on `bc tool <slug>`. |
| `scope` | ✓ | `shared` (global; `org_id=NULL`), `company` (per-org), `personal` (per-user). |
| `name` | ✓ | Display string. ≤ 200 chars. |
| `description` | — | Optional. ≤ 2 000 chars. |
| `transport` | ✓ | One of `stdio`, `http`, `sse`, `websocket`. |
| `target` | ✓ | For `stdio`: command line. For `http`/`sse`/`websocket`: URL. |
| `env_keys` | — | Array of env-var names the runtime injects. Values stay in the host env. |
| `input_schema` | — | Free-form record. v0 stores it as-is for the UI to render. |

## Lifecycle

- **First boot of a new tool YAML** — registry inserts a row with `enabled=true`.
- **Subsequent boots** — registry upserts (`ON CONFLICT (org_id, slug, version)`); only `manifest_path`, `name`, `description`, `transport`, `target`, `env_keys`, `input_schema`, `updated_at` get refreshed. `enabled` and `created_at` are preserved.
- **Disabling a tool** — set `enabled = false` in the DB; the manifest stays. Re-running registry sync does not re-enable. Use `bc tool ...` (future verb) or direct SQL.
- **Removing a tool** — delete the YAML *and* the row. The registry does not garbage-collect rows whose manifest has disappeared (intentional — keeps audit history).

## CLI

```bash
bc tools                              # list visible tools
bc tools --transport=stdio            # filter
bc tool web.fetch                     # detail view of one tool
bc tool invoke web.fetch --input.url=https://example.com
bc tool probe web.fetch               # liveness check (MCP initialize)
```

## Invocation (Phase 2.2 — shipped)

`POST /api/tools/:slug/invoke` runs the tool synchronously. v0 supports stdio transport only; HTTP / SSE / WebSocket return 501. Each invocation:

1. Looks up the manifest in `ops.tool` (latest version, must be `enabled=true`).
2. Validates that every entry in `env_keys` is set in the host process; returns 412 with the missing list otherwise.
3. Spawns the `target` command as a fresh subprocess (e.g. `npx @modelcontextprotocol/server-fetch`).
4. Runs the MCP handshake: `initialize` → `notifications/initialized` → `tools/call`.
5. Reads the response, kills the subprocess, returns `{ output, latency_ms }`.
6. Records the call to `ops.tool_call_log` (success or failure) and emits an audit row.

Hard ceiling: 30s per call (override via `timeout_ms` body field, capped at 60s).

The server-side MCP tool name defaults to the slug suffix (`web.fetch` → `fetch`). Override with the manifest's `tool_name` field when they differ.

### Direct invocation does not pass through the policy engine

When you (or the CLI) call `POST /api/tools/:slug/invoke`, no policy check fires — operator intent is implicit. Agent-initiated tool use happens through **skills**, which **do** go through the policy engine. So in practice: skills are the gated layer, tools are the building blocks skills compose from.

## Liveness probing

Each enabled stdio tool gets a non-blocking probe a few seconds after Paperclip boots. The probe runs the MCP `initialize` handshake (no `tools/call`), and on failure flips the row's `enabled` to `false`. This means a broken tool gets quietly disabled instead of erroring on every invocation.

You can probe manually any time:

```bash
bc tool probe web.fetch
```

A probe that succeeds for a previously-disabled tool re-enables it.

To opt out at boot (useful for tests or when you want a fast restart), set `PAPERCLIP_TOOL_PROBE_AT_BOOT=false`.
