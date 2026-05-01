# Skills Catalog — Capabilities pillar of the Four Cs

The L2 intelligence layer: discoverable units of work that agents can invoke. See [`docs/SKILLS.md`](../../docs/SKILLS.md) for the deep spec.

```
packages/skills/
├── README.md                     # this file
├── manifests/
│   ├── shared/                   # ships with the OS — works in any org
│   │   ├── web.fetch.yaml
│   │   ├── web.search.yaml
│   │   ├── web.browse.yaml
│   │   ├── email.send.yaml
│   │   ├── nango.invoke.yaml
│   │   ├── self.audit.yaml          # weekly self-improvement audit
│   │   ├── self.level_up.yaml       # weekly level-up suggestions
│   │   ├── google.gmail.search.yaml
│   │   ├── google.calendar.create_event.yaml
│   │   ├── google.drive.search.yaml
│   │   ├── google.docs.append.yaml
│   │   └── google.sheets.append_row.yaml
│   ├── company/                  # per-org skills, dropped in by operators
│   └── personal/                 # per-user skills, single-user mode
└── src/                          # (reserved) shared TypeScript helpers
```

Personal vs company vs shared:
- **shared** — global registry under `manifests/shared/`. Any org can use. Mirrored to `ops.skill` with `org_id IS NULL`.
- **company** — per-org. `ops.skill.org_id` set, `scope='company'`.
- **personal** — only relevant in single-user mode; same as company-scoped but tied to the personal org.

## Manifest format

Each `.yaml` file is one skill.

```yaml
id: web.fetch                 # globally unique slug; use dotted namespace
version: 1                    # bump on breaking input changes
scope: shared                 # personal | company | shared
mode_aware: false             # if true, behaviour differs single vs multi user
agent_kind: openclaw          # which agent kind executes (hermes | openclaw | langgraph)
title: Fetch a URL
description: |
  Politely fetches a URL with SSRF guards and stores it as a document memory.
inputs:                       # JSONSchema-like; validated at invoke time
  url:
    type: string
    format: uri
    required: true
  timeout_s:
    type: integer
    default: 30
side_effects: read            # read | write | external
permissions:
  required_role: any          # any | owner | department_lead | team_member | auditor | agent
  approval_under: 0           # auto-approve threshold ($, when relevant)
```

## How it wires in

1. **Loader** (`apps/paperclip/src/skills/loader.ts`) reads every manifest on boot.
2. **Registry** mirrors manifests into `ops.skill` so the API can serve them under RLS scoping.
3. **API** exposes:
   - `GET /api/skills` — list available skills for the caller's scope
   - `GET /api/skills/:slug` — single manifest
   - `POST /api/skills/:slug/invoke` — synthesise an ephemeral goal + dispatch a run on the right agent kind
4. **Agents** execute via the existing adapter contract — `POST /run` with `input.skill = "<id>"`.

## Authoring

Drop a new YAML file under `manifests/` and restart Paperclip. The boot-time loader picks it up, validates against the Zod `SkillManifest` schema, and registers it. To override a shared skill in a specific org, place a `company`-scoped manifest with the same `id`.
