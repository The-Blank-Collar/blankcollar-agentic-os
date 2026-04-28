# Roles & Scoped Access

Blank Collar is multi-user from day one. The schema in `infra/docker/postgres/init.sql` already encodes the role model below.

## Role enum

Defined in `core.role_kind`:

| Role               | Scope                                         | Typical real-world user     |
|--------------------|-----------------------------------------------|-----------------------------|
| `owner`            | Entire organization                           | Founder / CEO               |
| `department_lead`  | One department (Marketing, Sales, …)          | Head of Marketing           |
| `team_member`      | Specific goals they are assigned to           | IC contributor              |
| `auditor`          | Read-only across the org                      | Compliance / accountant     |
| `agent`            | Inherits the goal owner's scope, minus admin  | A workforce agent (Hermes…) |

## Assignment model

`core.role_assignment(user_id, department_id, role)`:

- `department_id IS NULL` ⇒ org-wide assignment (only meaningful for `owner` and `auditor`).
- A user can hold multiple assignments (e.g. `owner` + `department_lead` of Marketing).
- The `(user_id, department_id, role)` tuple is unique.

## Enforcement (3 layers)

1. **Edge / API.** Paperclip resolves the calling user's roles into an effective scope: `{org_id, department_ids, goal_ids, role_kinds}`. Every controller checks the scope before reading or writing.
2. **Memory.** `gbrain` accepts a scope on every `/recall` and `/remember`. Recall queries filter `brain.memory` by `(org, department, goal)` and by `visible_to ARRAY` containing the caller's role.
3. **Tools / Skills.** L2 (Phase 5) maintains a policy table mapping `(role, skill)` to allow / require-approval / deny. Tool calls go through this gate.

## Defaults that ship in Phase 0

- `core.role_kind` enum and `core.role_assignment` table exist.
- `brain.memory.visible_to` defaults to `['owner','department_lead']` — the safe default.
- No login UI yet; until Phase 6, any local script that connects to Postgres effectively has owner access. Treat the local stack as single-tenant.

## Designing new features against roles

When you add a feature, ask:

1. **Who can read it?** (which roles)
2. **Who can write it?**
3. **Does it surface in the audit log?** (if it mutates state, yes)
4. **Does it default to the most restrictive scope?** (yes, unless the user opts out)

If you can't answer all four, the feature isn't ready to merge.
