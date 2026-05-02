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
GET /goals?status=active&kind=standing&department_id=<uuid>&stalled_for_days=7
→ 200 [{ ...goal }]
```

`stalled_for_days=N` filters to active/draft goals whose newest run is older than `N` days (or that have no runs and were created `> N` days ago) — backs the "stalled" report.

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

The scheduler auto-generates a daily briefing for every active org once per UTC day at `PAPERCLIP_BRIEFING_HOUR_UTC` (default 8). Idempotent — orgs that already have today's briefing are skipped. Per-user / per-org timezone settings land in Phase 6.

### Approvals

Agents that propose a side-effecting action (send a payment, hire someone, send an email) create an approval row and pause. The user resolves; on approval the originating run is flipped to `succeeded`, on decline to `failed`. v0 stores the proposal cleanly so the UX exists ahead of the agent-side adoption work.

```http
POST /approvals
{
  "action_kind": "email.send" | "payment.charge" | "hire.extend_offer" | ...,
  "proposal":   { ... },
  "reason?":    "string",
  "urgency":    "low" | "normal" | "urgent",
  "goal_id?":   "<uuid>",
  "run_id?":    "<uuid>",
  "requesting_agent_id?": "<uuid>",
  "expires_in_hours?": 24
}
→ 201 { ...approval row }
```

```http
GET    /approvals?status=pending|resolved|all&urgency=low|normal|urgent&limit=20
GET    /approvals/{id}
POST   /approvals/{id}/approve   { "note?": "string" }
POST   /approvals/{id}/decline   { "note?": "string" }
```

Pending approvals also surface in `/api/inbox` as `item_kind=approval` (above decisions in the urgency order).

### Channels

```http
GET /channels
→ 200 {
  "channels": [{
    "id":                  "<connection or sentinel id>",
    "provider":            "slack" | "google" | "email" | "webhook" | ...,
    "display":             "Slack" | "Google Workspace" | ...,
    "connection_id":       "<nango>" | null,
    "state":               "connected" | "disconnected",
    "last_activity_at":    "<iso>" | null,
    "recent_capture_count": <int>
  }],
  "generated_at": "<iso>"
}
```

Sources: Nango `/connection` for OAuth-managed providers; the `email` and `webhook` channels are sentinel rows wired to the email-ingest service and `/api/webhooks/capture` respectively.

### Webhooks

```http
POST /webhooks/stripe          (existing, HMAC via Stripe-Signature)
POST /webhooks/capture
Headers: X-BC-Signature: hmac-sha256=<hex>
{ "raw_content": "<text>", "title?": "<string>", "metadata?": {...} }
→ 201 { "capture_id", "goal_id", "intent" }
```

`/webhooks/capture` runs the same classifier as `/api/capture` (heuristic + LLM upgrade when `ANTHROPIC_API_KEY` is set) and persists with `source=webhook`. Returns `503` when `INBOUND_CAPTURE_WEBHOOK_SECRET` is unset.

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

The Inbox answers the only question that matters: "what wants me?" It's not a folder of unread emails — it's the prioritised feed of things waiting on the human. v0 sources four item kinds; Phase 5 adds approval requests from the policy engine.

```http
GET /inbox?limit=20
→ 200 [{
  "item_kind": "decision" | "routine_output" | "draft" | "blocked",
  "goal_id": "<uuid>",
  "title": "Should I extend the offer to candidate C-019?",
  "created_at": "...",
  "urgency": "urgent" | "normal",
  "metadata": { ... }
}]
```

Ordering: urgent first, then by item kind (decisions → routine outputs → drafts → blocked), then most-recent.

Item kinds:
- `decision` — kind=decision goals in `draft`/`active` state. Resolve via `POST /goals/:id/resolve`.
- `routine_output` — a routine fired and produced unacknowledged output (e.g. *"your Monday digest is ready"*). Acknowledge via `POST /inbox/acknowledge/:goal_id`.
- `draft` — a succeeded run on a standing/ephemeral goal whose output hasn't been acknowledged. Same acknowledge endpoint.
- `blocked` — paused goals. Unblock by un-pausing the goal (`PATCH /goals/:id` with status).

```http
POST /inbox/acknowledge/{goal_id}
→ 200 { "kind": "ok", "runs_acknowledged": <int> }
→ 404 { "error": "not_found" }
```

Sets `acknowledged_at = now()` on every unacknowledged succeeded run for the goal, so the inbox stops surfacing it. Idempotent.

```http
GET /inbox/summary
→ 200 {
  "total":  <int>,
  "urgent": <int>,
  "by_kind": {
    "approval":       <int>,
    "decision":       <int>,
    "routine_output": <int>,
    "draft":          <int>,
    "blocked":        <int>
  }
}
```

Featherweight version of `/inbox` for the briefing rail and the mobile companion: just the integers needed to render badges. `urgent` is the sum of urgent approvals + decisions due within 48 h.

### Departments

```http
GET /departments
→ 200 [{
  "id":                "<uuid>",
  "slug":              "marketing",
  "name":              "Marketing",
  "created_at":        "...",
  "active_goal_count": 6
}]
```

Lists every department in the caller's org with a count of active+draft goals — backs the org-overview tab and `bc depts`.

### Payments (outbound spend safety)

Phase 9 backend prep: settings, per-agent spending caps, kill switch, payment-request lifecycle. The Stripe connector ships in a future cloud sprint — until then approved requests stay in `status='approved'` with no `external_ref`.

```http
GET /payments/settings
→ 200 {
  "enabled":              false,
  "kill_switch":          false,
  "default_limit_cents":  0,
  "default_period":       "per_request" | "daily" | "weekly" | "monthly",
  "approval_threshold":   0,
  "notify_email":         null,
  "updated_at":           "..."
}

PUT /payments/settings
{ "enabled": true, "default_limit_cents": 5000, "default_period": "monthly", "approval_threshold": 10000 }
```

```http
GET /payments/limits
POST /payments/limits     { "agent_id": "<uuid>", "limit_cents": 2000, "period": "monthly", "category": "research" }
DELETE /payments/limits/{id}
```

```http
POST /payments/kill       { "reason": "..." }   → flips kill_switch ON, logs event
POST /payments/resume     { "reason": "..." }   → flips kill_switch OFF, logs event
```

```http
POST /payments/request
{
  "agent_id":     "<uuid>",     // optional
  "amount_cents": 4500,
  "currency":     "USD",
  "vendor":       "Anthropic",
  "category":     "research",   // optional
  "description":  "API credits top-up"
}
→ 201 {
  "id":             "<uuid>",
  "status":         "approved" | "pending" | "declined" | "killed",
  "decided_reason": "...",
  "approval_id":    "<uuid>" | null,    // set when status=pending
  "amount_cents":   4500,
  ...
}
```

Status decision tree (in order):
1. `kill_switch=true` → `killed`.
2. `enabled=false` → `declined`.
3. Per-agent cap (or default) + period rollup: if `spent + amount > limit` → `declined`.
4. Policy engine `(action_kind="payment.charge")`: `deny` → `declined`, `approve` → `pending`.
5. `amount_cents >= approval_threshold` (when threshold > 0) → `pending`.
6. Otherwise → `approved`.

When `pending`, an `ops.approval` row is created (`action_kind="payment.charge"`, urgency=`urgent` if amount ≥ $1000). Approving it transitions the payment to `approved`; declining → `declined`.

```http
GET /payments/requests?status=pending&limit=50
```

### Tools (MCP registry)

YAML manifests in `packages/tools/manifests/{shared,company,personal}/` upsert into `ops.tool` on every Paperclip boot. The catalog is read-only at the API layer in v0; invocation lives behind a future MCP-client transport.

```http
GET /tools?transport=stdio
→ 200 [{
  "id":            "<uuid>",
  "slug":          "web.fetch",
  "version":       1,
  "scope":         "shared" | "company" | "personal",
  "name":          "Fetch a web URL",
  "description":   "...",
  "transport":     "stdio" | "http" | "sse" | "websocket",
  "target":        "npx @modelcontextprotocol/server-fetch",
  "env_keys":      ["PGHOST", "..."],
  "input_schema":  { ... },
  "manifest_path": "/app/packages/tools/manifests/shared/web.fetch.yaml",
  "enabled":       true
}]
```

```http
GET /tools/{slug}
→ 200 { ...tool }
→ 404 { "error": "tool_not_found" }
```

### Policy engine

Every skill invocation passes through the policy engine before queueing. Policies match on any combination of `(role, agent_kind, skill_slug, action_kind)` — null criteria are wildcards. Multiple matches: lowest `priority` wins, ties broken by specificity (fewer wildcards), then most-recent. No match → default `allow`.

```http
GET /policies
→ 200 [{
  "id":          "<uuid>",
  "role":        "team_member" | null,
  "agent_kind":  "openclaw"    | null,
  "skill_slug":  "google.gmail.send" | null,
  "action_kind": "skill.google.gmail.send" | null,
  "effect":      "allow" | "approve" | "deny",
  "priority":    100,
  "reason":      "outbound email needs review",
  "created_at":  "..."
}]
```

```http
POST /policies
{
  "effect":     "approve",
  "skill_slug": "google.gmail.send",
  "priority":   50,
  "reason":     "outbound email needs review"
}
→ 201 { ...policy }
```

```http
DELETE /policies/{id}
→ 204
→ 404 { "error": "not_found" }
```

```http
POST /policies/evaluate
{ "role": "team_member", "skill_slug": "google.gmail.send" }
→ 200 { "effect": "approve" | "deny" | "allow", "matched": {...policy} | null }
```

Skill invoke wiring:
- `effect=allow` → existing 201 `{ goal_id, run_id, status: "queued" }`.
- `effect=deny` → 403 `{ error: "denied_by_policy", reason, policy_id }`. No goal/run created.
- `effect=approve` → 202 `{ status: "pending_approval", approval_id, goal_id }`. Goal is created; run is *not* queued. The full invoke parameters are stored on the approval's `proposal` jsonb. When `POST /approvals/:id/approve` fires, the run is enqueued and the approval's `run_id` is backfilled. Decline → no run.

### Approvals summary

```http
GET /approvals/summary
→ 200 {
  "pending": { "total": <int>, "urgent": <int>, "normal": <int>, "low": <int> },
  "recent":  { "approved_7d": <int>, "declined_7d": <int>, "expired_7d": <int> }
}
```

Counts only — for the governance rail and `bc approvals --summary`. Pending excludes already-expired entries.

### Whoami

Resolved caller scope — org, role, department — for the status-bar rail and `bc whoami`.

```http
GET /whoami
→ 200 {
  "org":        { "id": "<uuid>", "slug": "blankcollar-personal", "name": "Personal" },
  "role":       "owner" | "department_lead" | "team_member" | "auditor",
  "department": { "id": "<uuid>", "name": "Marketing" } | null,
  "goal_id":    "<uuid>" | null
}
```

### Search

Cross-corpus search across goals / captures / knowledge / agents — one endpoint backing the ⌘K palette and the `bc search` CLI.

```http
GET /search?q=lark&kind=all&limit=20
→ 200 [{
  "kind":       "goal" | "capture" | "knowledge" | "agent",
  "id":         "<uuid>",
  "title":      "Close the Lark proposal",
  "snippet":    "…the lark milestone draft is awaiting…",
  "score":      11,
  "created_at": "...",
  "metadata":   { ... }
}]
```

`kind=all` (default) interleaves all four corpora ordered by score then recency. Filter to one corpus with `kind=goal|capture|knowledge|agent`. `q` must be ≥ 2 chars (returns 400 otherwise). v0 is ILIKE-based; tsvector-rank arrives when any corpus crosses 10k rows per org.

### Stats / Activity

Per-goal run rollup, per-agent run rollup, an org-wide goal-summary, and a chronological activity feed. All derived views over `ops.run` + `ops.goal` + `ops.agent` — no new tables.

```http
GET /goals/summary?stalled_days=7
→ 200 {
  "total":         42,
  "by_kind":       { "ephemeral": 12, "standing": 6, "routine": 4, "decision": 20 },
  "by_status":     { "draft": 1, "active": 30, "paused": 3, "achieved": 7, "archived": 1 },
  "stalled_count": 5
}
```

```http
GET /agents/{id}/stats
→ 200 {
  "agent_id":        "<uuid>",
  "runs_total":      214,
  "runs_succeeded":  198,
  "runs_failed":     12,
  "runs_running":    1,
  "success_rate":    94.3,
  "avg_duration_ms": 4280,
  "last_run_at":     "..."
}
→ 404 { "error": "not_found" }
```

```http
GET /goals/{id}/stats
→ 200 {
  "goal_id":         "<uuid>",
  "runs_total":      14,
  "runs_succeeded":  11,
  "runs_failed":     1,
  "runs_running":    1,
  "runs_queued":     1,
  "avg_duration_ms": 4280,
  "last_run_at":     "...",
  "last_run_status": "succeeded"
}
→ 404 { "error": "not_found" }
```

```http
GET /activity?limit=20
→ 200 [{
  "run_id":         "<uuid>",
  "goal_id":        "<uuid>",
  "goal_title":     "Close the Lark proposal",
  "goal_kind":      "ephemeral",
  "agent_id":       "<uuid>" | null,
  "status":         "succeeded" | "failed" | "running" | ...,
  "started_at":     "...",
  "finished_at":    "...",
  "created_at":     "...",
  "duration_ms":    4280,
  "subtask_title":  "Draft the milestone clause" | null
}]
```

`limit` is capped at 100. Most recent first. Backs the activity rail on the dashboard and `bc tail` in the CLI.

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
    { "kpi": "runs_failed",    "label": "Runs failed",     "unit": "count",  "points": [...] },
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

### Tool invocation (Phase 2.2)

Synchronous MCP tool invocation through paperclip. Spawns the registered subprocess, runs the JSON-RPC handshake, returns the result. Every call is logged to `ops.tool_call_log`.

```http
POST /tools/{slug}/invoke
{
  "input":      { "url": "https://example.com" },
  "run_id":     "<uuid>" | null,        // optional — link to a run
  "timeout_ms": 30000                   // optional, capped at 60000
}
→ 200 {
  "slug":       "web.fetch",
  "version":    1,
  "output":     [...],                   // tool's MCP "content" array
  "latency_ms": 870
}
→ 404 { "error": "tool_not_found" }
→ 412 { "error": "missing_env_keys", "missing": ["PGHOST", ...] }
→ 501 { "error": "transport_not_supported" }   // non-stdio
→ 502 { "error": "tool_call_failed", "detail": "...", "stderr_tail": "..." }
```

```http
POST /tools/{slug}/probe
→ 200 {
  "slug":        "web.fetch",
  "ok":          true,
  "latency_ms":  920,
  "error":       null,
  "stderr_tail": null,
  "enabled":     true
}
```

Probe runs the `initialize` handshake only. A successful probe of a previously auto-disabled tool flips it back to enabled; an unsuccessful probe of a currently enabled tool disables it.

### LLM call log (Phase 2.1.c)

Every LLM call routed through Portkey is recorded in `ops.llm_call_log`. The Portkey dashboard already shows this — keeping a local copy means `bc tail`, `bc llm`, and the future console can render cost/latency without leaving paperclip, and it's a forensic backup if Portkey is unreachable.

```http
GET /llm/calls?limit=50&status=ok|error&provider=anthropic|openrouter
→ 200 [{
  "id":               "<uuid>",
  "run_id":           "<uuid>" | null,
  "provider":         "anthropic" | "openrouter",
  "model":            "claude-sonnet-4-6",
  "tokens_in":        1240,
  "tokens_out":       310,
  "latency_ms":       870,
  "status":           "ok" | "error",
  "error":            null | "...",
  "portkey_trace_id": "trc_..." | null,
  "created_at":       "..."
}]
```

```http
GET /llm/summary?hours=24
→ 200 {
  "period_hours":   24,
  "period_start":   "...",
  "total":          42,
  "tokens_in":      52480,
  "tokens_out":     12140,
  "avg_latency_ms": 870,
  "errors":         1,
  "by_model":       [{ "model": "claude-sonnet-4-6", "count": 42, "tokens_in": ..., "tokens_out": ... }],
  "by_status":      [{ "status": "ok", "count": 41 }, { "status": "error", "count": 1 }]
}
```

`hours` is capped at 720 (30 days). Backs `bc llm --summary`.

### Audit

```http
GET /audit?actor_id=&action=&limit=100
→ 200 [{ id, actor_id, actor_role, action, target_type, target_id, metadata, created_at }]
```

Auditors get read-only access to this endpoint org-wide.

### Live telemetry — Server-Sent Events

```http
GET /runs/{id}/stream
Accept: text/event-stream
```

Emits SSE frames each time the run's status / output / error changes:

```
event: snapshot
data: {"status":"running","output":null,"error":null,"started_at":"…","finished_at":null}

event: snapshot
data: {"status":"succeeded","output":{…},"error":null,"started_at":"…","finished_at":"…"}

event: done
data: {"status":"succeeded"}
```

Hard timeout: 10 minutes. Terminal statuses (`succeeded` / `failed` / `cancelled`) emit a final `done` event and close the stream. The CLI's `bc run <id> --watch` uses this endpoint.

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
