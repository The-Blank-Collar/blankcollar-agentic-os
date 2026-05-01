# API Contracts

Everything below is **the contract**, not the implementation. Phase 0 ships placeholder containers; Phase 1+ implementations must match these shapes. If you must change a shape, change this doc in the same PR.

All requests are JSON. All requests carry an authenticated user (Phase 6+) and resolve to a **scope**:

```ts
type Scope = {
  org_id: string;
  department_id?: string;
  goal_id?: string;
  role: "owner" | "department_lead" | "team_member" | "auditor" | "agent";
};
```

Scope is enforced at the controller layer and re-asserted in `gbrain` for memory ops.

## Paperclip (L4)

Base URL (local): `http://localhost:3000/api`.

### Goals

A goal is the internal planning primitive — but the user never types "create a goal". They send natural language to `/capture` (below), and the classifier resolves it into one of four kinds:

- **`ephemeral`** — one-off task, runs once, archives
- **`standing`** — long-lived objective with key results
- **`routine`** — recurring on a cron schedule
- **`decision`** — single yes/no awaiting the user

```http
POST /goals
{
  "title": "Reach 1k newsletter subscribers by July",
  "description": "...",
  "department_id": "<uuid|null>",
  "kind": "standing",                   # default: ephemeral
  "cron_expr": "0 9 * * 1",             # only meaningful for kind=routine
  "due_at": "2026-07-01T00:00:00Z",
  "target_value": "1000",
  "metadata": { ... }
}
→ 201 { "id", "kind", "status": "draft", ... }
```

```http
GET /goals?status=active&kind=standing&department_id=<uuid>
→ 200 [{ ...goal }]
```

```http
GET /goals/{id}
→ 200 { ...goal,
         "key_results": [{ id, label, target_value, current_value, unit, weight, due_at, ... }],
         "contributors": [{ agent_id|user_id, added_at }] }

PATCH /goals/{id}      # title, description, kind, cron_expr, due_at,
                       # progress, target_value, actual_value, delta_label,
                       # track_state, metadata, status
DELETE /goals/{id}     # soft archive
```

```http
POST /goals/{id}/resolve         # only valid for kind=decision goals
{ "resolution": "approved" | "declined", "note?": "string" }
→ 200 { ...goal }                # status moves to 'achieved' (approved) or 'archived' (declined)
→ 409 { "error": "not_a_decision" | "already_resolved" }
```

### Key results

```http
GET    /goals/{id}/key-results       → 200 [{ ...kr }]
POST   /goals/{id}/key-results       { "label", "target_value?", "current_value?", "unit?", "weight?", "due_at?" } → 201
PATCH  /key-results/{id}             → 200
DELETE /key-results/{id}             → 204
```

### Captures (the user's verb)

The user never says "create a goal." They throw raw text (or email / voice / image later) at `/capture`. The classifier resolves it to the right downstream shape (today: a goal of one of the four kinds; tomorrow: also memories, decisions, contacts).

```http
POST /capture
{
  "raw_content": "Every Monday morning, summarise the weekend in my inboxes",
  "source": "text" | "email" | "voice" | "image" | "webhook",
  "metadata?": {}
}
→ 201 {
  "capture_id": "<uuid>",
  "goal_id": "<uuid>",
  "intent": { "kind": "routine", "title": "...", "cron_expr": "0 8 * * 1" },
  "created_at": "..."
}
```

```http
GET /capture
→ 200 [{ id, source, raw_content, parsed_intent, resolved_to_id, resolved_kind, created_at }]
```

The capture row is the audit trail of "what did you tell me, and what did I do with it."

### Briefings

A briefing is a generated editorial summary — not a button, a real resource. v0 templates the markdown deterministically from current state; Phase 5 routes the same input through Hermes for narrative prose in brand voice.

```http
GET /briefing/today
→ 200 { id, kind: "daily", generated_at, period_start, period_end,
         summary_md, sources: { hours, goal_count, decision_count, run_count, ... },
         audio_url? }
```

If today's daily briefing doesn't exist yet, this endpoint generates one on demand and persists it.

```http
GET /briefing?kind=weekly&limit=14
→ 200 [{ ...briefing }]
```

```http
POST /briefing/generate
{ "kind": "daily" | "weekly" | "on_demand", "period_hours?": 24 }
→ 201 { ...briefing }
```

When `ANTHROPIC_API_KEY` is set on Paperclip, the templated briefing is post-processed by Claude in brand voice (loaded from `/app/brand/{BRAND_NAME}.md`). The structured `sources` block stays unchanged — only `summary_md` becomes editorial. When the key is unset, briefings render via the deterministic template so the demo runs offline. The `sources.narrated` boolean tells the UI which path was taken.

### Routines

Goals with `kind=routine` carry a `cron_expr` and are fired automatically by Paperclip's in-process scheduler. v0 grammar is constrained to what the capture classifier produces:

```
M H D MON DOW
```

- `M` minute (0–59) or `*`
- `H` hour (0–23) or `*`
- `D` and `MON` must be `*` (day-of-month / month not supported in v0)
- `DOW` day-of-week (0=Sunday … 6=Saturday) or `*`

Examples: `0 9 * * 1` (Mondays at 9), `0 8 * * *` (daily at 8), `0 * * * *` (hourly). Each fire generates a plan from the routine's title/description and dispatches one run per subtask. Disable with `PAPERCLIP_SCHEDULER_ENABLED=false`.

### Brain graph

Synthesised nodes + edges for the design's constellation page. v0 derives from `ops.goal` + `ops.agent` + `ops.capture` + recent `ops.run`s; the Graphiti-canonical version (queryable `/graph` over Neo4j) lands later.

```http
GET /brain/graph?limit=80
→ 200 {
  "nodes": [
    { "id", "kind": "person" | "agent" | "goal" | "capture" | "tool",
      "label": "string", "metadata?": { ... } }
  ],
  "edges": [{ "from", "to", "kind": "owns" | "contributes" | "captures" | "ran" }],
  "truncated": false,
  "generated_at": "..."
}
```

Edge kinds:
- `owns` — person → goal (via `goal.owner_id`)
- `contributes` — person/agent → goal (via `ops.goal_contributor`)
- `ran` — agent → goal (recent run within 14 days)
- `captures` — capture → goal (the capture that created it)

### Inbox

The Inbox answers the only question that matters: "what wants me?" It's not a folder of unread emails — it's the prioritised feed of things waiting on the human. v0 sources three item kinds; Phase 5 adds approval requests from the policy engine.

```http
GET /inbox?limit=20
→ 200 [{
  "item_kind": "decision" | "blocked" | "draft",
  "goal_id": "<uuid>",
  "title": "Should I extend the offer to candidate C-019?",
  "created_at": "...",
  "urgency": "urgent" | "normal",
  "metadata": { ... }
}]
```

Ordering: urgent first, then by item kind (decisions before drafts before blocked), then most-recent.

### Heartbeat

14-day system pulse for the design's sparkline rail and the Goal Detail timeline. v0 reports what we have data for; richer business KPIs (ARR, pipeline, margin) land when Stripe / CRM data is connected.

```http
GET /heartbeat?days=14
→ 200 {
  "period_days": 14,
  "period_start": "...",
  "period_end": "...",
  "series": [
    { "kpi": "captures",       "label": "Captures",        "unit": "count",  "points": [{ "date": "2026-04-15", "value": 3 }, ...] },
    { "kpi": "runs_completed", "label": "Runs completed",  "unit": "count",  "points": [...] },
    { "kpi": "goals_active",   "label": "Goals in flight", "unit": "count",  "points": [...] },
    { "kpi": "activity",       "label": "Activity",        "unit": "events", "points": [...] }
  ]
}
```

Series are date-aligned (one point per day, missing days = 0) so the frontend can chart them directly without re-aligning.

### Runs

```http
POST /goals/{id}/plan
→ 200 { "subtasks": [{ "title": "...", "input": {...} }, ...] }
```

```http
POST /goals/{id}/dispatch
{ "subtask_index": 0, "agent_id": "<uuid|optional>" }
→ 201 { "run_id": "<uuid>", "status": "queued" }
```

```http
GET /runs/{id}
→ 200 { "id", "status", "input", "output?", "error?", "started_at", "finished_at" }
```

```http
POST /runs/{id}/cancel
→ 200 { "status": "cancelled" }
```

### Agents

```http
POST /agents
{ "kind": "hermes", "name": "Hermes — Marketing", "config": {...} }
→ 201 { "id": "<uuid>" }

GET /agents?is_active=true
PATCH /agents/{id}      # config edit, name, is_active=false (fire)
```

```http
GET /agents/{id}/state
→ 200 {
  ...agent,
  "status": "live" | "idle" | "warn",
  "current_activity": "Working on: <goal title>" | null,
  "last_run": { ...run } | null,
  "recent_runs": [{ ...run, "goal_title": "..." }],
  "sigil_seed": "<deterministic>"     # used by the UI for the agent's geometric mark
}
```

`status` is derived: `live` if there's a running run, `warn` if the most-recent terminal run failed, `idle` otherwise. `sigil_seed` is stable across requests so the visual identity is constant.

### Audit

```http
GET /audit?actor_id=&action=&limit=100
→ 200 [{ id, actor_id, actor_role, action, target_type, target_id, metadata, created_at }]
```

Auditors get read-only access to this endpoint org-wide.

### Live telemetry

WebSocket `GET /runs/{id}/stream` — emits `{ type: "log" | "tool_call" | "status", payload, ts }`.

## Agent Adapter Contract (L3)

Every agent — Hermes, OpenClaw, future — exposes the same minimum HTTP API to Paperclip. The adapter folder (`apps/<agent>/`) translates between this contract and the underlying agent's native interface.

```http
POST /run
{
  "goal_id": "<uuid>",
  "run_id": "<uuid>",
  "input": { ...arbitrary task payload },
  "scope": { ...Scope }
}
→ 202 { "status": "running" }
```

```http
GET /run/{run_id}
→ 200 { "status": "running" | "succeeded" | "failed" | "cancelled",
         "output?": {...}, "error?": "..." }
```

```http
POST /run/{run_id}/cancel
→ 200 { "status": "cancelled" }
```

The adapter is responsible for:
- Calling `gbrain` with the same `scope` for any memory access.
- Calling the L2 policy engine before any skill use.
- Posting status updates back to Paperclip's stream endpoint.

## gbrain (L1)

Base URL (local, future): `http://localhost:8003`.

```http
POST /remember
{
  "kind": "fact" | "episode" | "document" | "conversation",
  "title?": "string",
  "content": "string",
  "scope": { ...Scope },
  "visible_to?": ["owner", "department_lead"],
  "metadata?": {}
}
→ 201 { "memory_id": "<uuid>" }
```

```http
POST /recall
{
  "query": "string",
  "scope": { ...Scope },
  "k": 10,
  "kinds?": ["fact", "document"],
  "min_score?": 0.7
}
→ 200 [{ "memory_id", "score", "content", "metadata" }]
```

```http
POST /forget
{ "memory_id": "<uuid>", "reason": "string" }
→ 200 { "ok": true }
```

Errors:
- `400` — missing scope or empty content
- `403` — scope is not authorized for this op
- `404` — memory not found
- `409` — duplicate write within idempotency window

## Skills / MCP (L2, Phase 5)

Skills are invoked via the policy engine, not directly by agents.

```http
POST /skill/{skill_id}/invoke
{ "args": {...}, "scope": { ...Scope }, "run_id": "<uuid>" }
→ 200 { "result": {...} } | 202 { "status": "pending_approval", "approval_id": "<uuid>" }
```

Approval flow:

```http
GET  /approvals?status=pending          → list pending approvals for current user
POST /approvals/{id}/approve            → release the skill call
POST /approvals/{id}/deny               → fail the originating run
```

## Webhooks (Phase 7)

### Stripe

```http
POST /webhooks/stripe
Headers: Stripe-Signature
→ 200
```

Verify with `STRIPE_WEBHOOK_SECRET`. Reject if signature is missing or invalid.

### Inbound email (`agent@blankcollar.ai`)

```http
POST /webhooks/email
Headers: X-Blankcollar-Signature: hmac-sha256=...
{ "from", "to", "subject", "text", "html?", "attachments?" }
→ 200
```

Verify with `INBOUND_EMAIL_WEBHOOK_SECRET`. Email becomes a memory of kind `conversation` plus, optionally, a new `goal` if the parser detects an actionable request.

## Row-Level Security (Phase 3.5)

Every org-scoped table (`ops.goal`, `ops.run`, `ops.agent`, `ops.key_result`, `ops.goal_contributor`, `ops.briefing`, `ops.capture`, `brain.memory`, `core.audit_log`) has RLS enabled with `FORCE ROW LEVEL SECURITY` so the policies apply to the application user, not just role-restricted users.

The single policy (`app_scope_org`) checks the session GUC `app.org_id`:

```sql
USING (
  current_setting('app.org_id', true) IS NULL
  OR current_setting('app.org_id', true) = ''
  OR org_id::text = current_setting('app.org_id', true)
)
```

When the GUC is unset, the policy is permissive — in-code scope filters in `resolveCallerScope()` remain authoritative. Routes opt into RLS by running queries inside `withOrgScope(orgId, fn)` (see `apps/paperclip/src/db.ts`), which sets the GUC via `SET LOCAL` for the duration of the transaction. Once every route has migrated, the unset branch flips to `false` and RLS becomes the only enforcement.

`ops.run`, `ops.key_result`, and `ops.goal_contributor` don't have a direct `org_id` column — their policy joins to `ops.goal` to derive scope.

## Versioning

- All endpoints under `/api/v1/...` once Paperclip ships in Phase 2.
- Breaking changes bump the prefix to `/v2`. Old paths stay live for one phase.
- `CHANGELOG.md` lists every shape change with the phase it landed.
