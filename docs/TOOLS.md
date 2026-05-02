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
```

## Where invocation lives (Phase 2.2)

The registry described here is the discovery surface. The MCP **client** that actually invokes a tool — spawning the stdio process or opening the HTTP/SSE/WebSocket connection — ships in Sprint 2.2 of the local-first plan. Until then, `ops.tool` is read-only from the agent's perspective.
