# Skills & MCP Tools

The intelligence layer (L2) — the abilities your agents have. Phase 5 is the home of this layer; the spec below is what we'll build against.

## What is a skill?

A skill is a **named, role-gated, auditable capability** an agent can invoke. Examples:

- `web.search` — query the web.
- `email.send` — send an email from `agent@blankcollar.ai`.
- `calendar.create_event` — drop something on a Google Calendar.
- `db.query_readonly` — run a SELECT against a connected database.

Skills are how Blank Collar agents **act on the world**. They are deliberately separated from the agent itself so that:

1. The same skill is reusable across agents.
2. Permissions and approval rules live in one place.
3. We can trade out the implementation (e.g. Brave → SerpAPI) without touching agents.

## Skill anatomy

Every skill ships with:

```yaml
id: email.send
name: Send Email
description: Send an email from the Blank Collar agent address.
inputs:
  to: { type: string, format: email, required: true }
  subject: { type: string, required: true }
  body_markdown: { type: string, required: true }
outputs:
  message_id: { type: string }
implementation:
  kind: builtin | mcp | http
  ref: ./impl.ts | mcp://gmail | https://...
policy_default: requires_approval     # allow | requires_approval | deny
audit_template: "{{actor}} sent email to {{inputs.to}}"
```

Skills are loaded into the registry on startup and can be hot-reloaded.

## MCP tools

The [Model Context Protocol](https://modelcontextprotocol.io) is a first-class implementation kind for skills. An MCP server registered with Blank Collar contributes its tools to the catalog with `implementation.kind: mcp`.

Day-1 supported MCP transports:

- `mcp://stdio?cmd=...` — local subprocess
- `mcp://http+sse?url=...` — remote server

Each MCP tool exposed becomes a skill `id` of the form `<server>.<tool>` and inherits the server's auth from the secure store.

## The Policy Engine

Every skill call goes through:

```
caller scope ──► policy engine ──► allow | require approval | deny
                                       │
                                       └─► (if approval) approval inbox
                                              │
                                              └─► human approves → skill fires
                                              └─► human denies   → run fails
```

Policy is expressed as a table:

| Role               | Default for *new* skill | Override pattern                                  |
|--------------------|-------------------------|---------------------------------------------------|
| `owner`            | allow                   | Can deny anything, can approve anything.          |
| `department_lead`  | requires_approval       | Can pre-approve specific skills for their dept.   |
| `team_member`      | requires_approval       | Approval comes from `department_lead` or `owner`. |
| `auditor`          | deny                    | Read-only role; never invokes side effects.       |
| `agent`            | inherits role of goal owner |                                                |

Per-skill overrides live in a policy table keyed by `(role, skill_id)`.

## The Approval Inbox

When a skill returns `requires_approval`, the originating run **pauses** and an approval request is created. Approval surfaces in the dashboard with:

- Who/what is asking
- The skill's audit-template-rendered description
- The exact arguments (truncated where huge)
- Approve / Deny buttons

Auditors can see approval activity but cannot approve.

## Idempotency

Skills are idempotent or they are not. A skill that is not idempotent **must** declare so (`idempotent: false`) and the policy engine will require an approval token even if otherwise allowed — the human becomes the idempotency gate.

## Built-in skills (Phase 5 catalogue, target)

| ID                    | Description                                       | Default policy           |
|-----------------------|---------------------------------------------------|--------------------------|
| `web.fetch`           | HTTP GET a URL.                                   | allow                    |
| `web.search`          | Query a search backend.                           | allow                    |
| `email.send`          | Send from agent inbox.                            | requires_approval        |
| `email.draft`         | Save a draft (no send).                           | allow                    |
| `calendar.create_event` | Drop event on connected calendar.               | requires_approval        |
| `db.query_readonly`   | SELECT against connected DB.                      | allow                    |
| `db.query_write`      | INSERT/UPDATE/DELETE.                             | requires_approval        |
| `file.write`          | Write a file in the agent's sandbox.              | allow (sandbox-only)     |
| `payments.charge`     | Charge a customer via Stripe.                     | requires_approval        |

## How skills get added

1. Drop a skill manifest into `packages/skills/<area>/<id>.yaml` and an implementation alongside it.
2. Register it in the catalogue (`packages/skills/index.ts` once Phase 5 ships).
3. Update `policy.table.yaml` with sensible defaults.
4. PR includes: manifest, impl, policy entries, an audit template, and a test that exercises the happy path.

## What skills are *not*

- Not where agents store memory. That's `gbrain`.
- Not where business logic about *whether* to do something lives — that's the agent reasoning step. Skills only *do*.
- Not a catch-all for prompt-engineering tricks.

If your skill PR needs the agent to "behave differently" in any way, it's not a skill — it's a change to the agent or the goal-first UX.
