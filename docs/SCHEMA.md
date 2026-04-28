# Schema Reference

The full Phase-0 data model. The source of truth is `infra/docker/postgres/init.sql`. This page is the human-readable companion.

## Schemas

| Schema   | What it holds                                                    |
|----------|------------------------------------------------------------------|
| `core`   | Identity & access — orgs, departments, users, roles, audit log.  |
| `ops`    | Operational state — agents, goals, runs.                         |
| `brain`  | Memory metadata. Vectors live in Qdrant; here we keep the index. |

## Diagram (text)

```
core.organization ─┬─< core.department ─┬─< ops.goal ─┬─< ops.run >─ ops.agent
                   │                    │             │
                   ├─< core.user_account─┴─< core.role_assignment
                   │
                   └─< core.audit_log

brain.memory      ─── (org / department / goal scope) ───  Qdrant collections
```

## `core.organization`

A single Blank Collar tenant. One row = one company.

| Column       | Type           | Notes                                |
|--------------|----------------|--------------------------------------|
| `id`         | uuid PK        | `gen_random_uuid()`                  |
| `slug`       | text UNIQUE    | URL-safe identifier.                 |
| `name`       | text           | Human display name.                  |
| `created_at` | timestamptz    |                                      |

Seed: one row, slug `blankcollar-demo`.

## `core.department`

| Column       | Type           | Notes                                            |
|--------------|----------------|--------------------------------------------------|
| `id`         | uuid PK        |                                                  |
| `org_id`     | uuid FK        | → `core.organization.id`, ON DELETE CASCADE      |
| `slug`       | text           | UNIQUE per `(org_id, slug)`                      |
| `name`       | text           |                                                  |
| `created_at` | timestamptz    |                                                  |

Seed: 5 departments (`marketing`, `sales`, `support`, `finance`, `engineering`).

## `core.user_account`

| Column         | Type           | Notes                                              |
|----------------|----------------|----------------------------------------------------|
| `id`           | uuid PK        |                                                    |
| `org_id`       | uuid FK        | → `core.organization.id`, ON DELETE CASCADE        |
| `email`        | citext UNIQUE  | Case-insensitive.                                  |
| `display_name` | text           |                                                    |
| `is_active`    | boolean        |                                                    |
| `created_at`   | timestamptz    |                                                    |

## `core.role_assignment`

The "who can do what" table.

| Column          | Type           | Notes                                                     |
|-----------------|----------------|-----------------------------------------------------------|
| `id`            | uuid PK        |                                                           |
| `user_id`       | uuid FK        | → `core.user_account.id`                                  |
| `department_id` | uuid FK NULL   | NULL = org-wide assignment                                |
| `role`          | enum           | `core.role_kind`                                          |
| `created_at`    | timestamptz    |                                                           |
| —               | —              | UNIQUE on `(user_id, department_id, role)`                |

`core.role_kind`: `owner | department_lead | team_member | auditor | agent`.

## `core.audit_log`

Append-only. Every state mutation in `ops` and `brain` writes a row here.

| Column        | Type           | Notes                                                        |
|---------------|----------------|--------------------------------------------------------------|
| `id`          | bigserial PK   |                                                              |
| `org_id`      | uuid FK NULL   | NULL allowed so we can record signups and similar.           |
| `actor_id`    | uuid FK NULL   | NULL = system actor.                                         |
| `actor_role`  | enum NULL      |                                                              |
| `action`      | text           | e.g. `goal.create`, `memory.forget`, `run.cancel`.           |
| `target_type` | text           | e.g. `goal`, `run`, `memory`.                                 |
| `target_id`   | text           | UUID or natural id of the affected row.                       |
| `metadata`    | jsonb          | Free-form extra context.                                      |
| `created_at`  | timestamptz    |                                                              |

Indexes: `(org_id, created_at DESC)`, `(actor_id, created_at DESC)`.

## `ops.agent`

The hired workforce.

| Column       | Type     | Notes                                                |
|--------------|----------|------------------------------------------------------|
| `id`         | uuid PK  |                                                      |
| `org_id`     | uuid FK  | ON DELETE CASCADE                                    |
| `kind`       | text     | `hermes`, `openclaw`, future kinds.                  |
| `name`       | text     | Human label ("Hermes — Marketing").                   |
| `config`     | jsonb    | Adapter-specific. Validated by the adapter.           |
| `is_active`  | boolean  | `false` after a fire, but row stays for audit.        |
| `created_at` | timestamptz |                                                   |

## `ops.goal`

| Column          | Type           | Notes                                                     |
|-----------------|----------------|-----------------------------------------------------------|
| `id`            | uuid PK        |                                                           |
| `org_id`        | uuid FK        | ON DELETE CASCADE                                         |
| `department_id` | uuid FK NULL   | ON DELETE SET NULL                                        |
| `owner_id`      | uuid FK NULL   | The human who created it.                                  |
| `title`         | text           |                                                           |
| `description`   | text           | Free-form goal in user's own words.                        |
| `status`        | enum           | `ops.goal_status`                                         |
| `metadata`      | jsonb          | KPI definitions, deadlines, etc.                           |
| `created_at`    | timestamptz    |                                                           |
| `updated_at`    | timestamptz    | Bumped on status change or metadata edit.                  |

`ops.goal_status`: `draft | active | paused | achieved | archived`.

Index: `(department_id, status)`.

## `ops.run`

| Column         | Type           | Notes                                                |
|----------------|----------------|------------------------------------------------------|
| `id`           | uuid PK        |                                                      |
| `goal_id`      | uuid FK        | ON DELETE CASCADE                                    |
| `agent_id`     | uuid FK NULL   | ON DELETE SET NULL — agent could be fired later.     |
| `status`       | enum           | `ops.run_status`                                     |
| `input`        | jsonb          | What the agent was asked to do.                       |
| `output`       | jsonb NULL     | Result, when done.                                    |
| `error`        | text NULL      | Stack/message on failure.                             |
| `started_at`   | timestamptz    |                                                      |
| `finished_at`  | timestamptz    |                                                      |
| `created_at`   | timestamptz    |                                                      |

`ops.run_status`: `queued | running | succeeded | failed | cancelled`.

Indexes: `(goal_id, created_at DESC)`, `(status, created_at)`.

## `brain.memory`

The Postgres half of the Company Brain. The vector itself lives in Qdrant; `vector_ref` is the pointer.

| Column          | Type                    | Notes                                                                  |
|-----------------|-------------------------|------------------------------------------------------------------------|
| `id`            | uuid PK                 |                                                                        |
| `org_id`        | uuid FK                 | ON DELETE CASCADE                                                      |
| `department_id` | uuid FK NULL            | ON DELETE SET NULL                                                     |
| `goal_id`       | uuid FK NULL            | ON DELETE SET NULL                                                     |
| `kind`          | enum                    | `brain.memory_kind`                                                    |
| `title`         | text NULL               |                                                                        |
| `content`       | text                    | Source-of-truth text. Embedding is derived from this.                   |
| `vector_ref`    | jsonb NULL              | `{ collection: "...", point_id: "..." }`                                |
| `visible_to`    | role_kind[]             | Default `[owner, department_lead]`. Mirrors app-level scope check.       |
| `metadata`      | jsonb                   | URLs, source, tags, anything.                                           |
| `created_at`    | timestamptz             |                                                                        |

`brain.memory_kind`: `fact | episode | document | conversation`.

Indexes: `(department_id, kind, created_at DESC)`, `(goal_id, created_at DESC)`.

## Qdrant collections

Naming convention (Phase 1 will create these on first write):

```
{org_slug}__{kind}
```

Examples for the demo org:

- `blankcollar-demo__fact`
- `blankcollar-demo__episode`
- `blankcollar-demo__document`
- `blankcollar-demo__conversation`

Payload always includes:

```json
{
  "memory_id": "<brain.memory.id>",
  "org_id": "<uuid>",
  "department_id": "<uuid|null>",
  "goal_id": "<uuid|null>",
  "visible_to": ["owner", "department_lead"]
}
```

This payload is what makes Qdrant filter-able **without** loading the full row from Postgres.

## Migration policy

- Phase 0 schema is intentionally generous so Phase 1–3 don't need migrations to land.
- New columns: add nullable, ship a default, never break existing rows.
- New tables: in the right schema (`core` / `ops` / `brain`).
- Renames/drops: a deprecation note in `CHANGELOG.md` *and* a graceful read path for one release.
