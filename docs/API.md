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

```http
POST /goals
{
  "title": "Reach 1k newsletter subscribers by July",
  "description": "...",
  "department_id": "<uuid|null>",
  "metadata": { "kpi": "subscribers", "target": 1000, "due": "2026-07-01" }
}
→ 201 { "id": "<uuid>", "status": "draft" }
```

```http
GET /goals?status=active&department_id=<uuid>
→ 200 [{ ...goal }]
```

```http
GET /goals/{id}
PATCH /goals/{id}      # title, description, metadata, status transition
DELETE /goals/{id}     # soft archive
```

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

## Versioning

- All endpoints under `/api/v1/...` once Paperclip ships in Phase 2.
- Breaking changes bump the prefix to `/v2`. Old paths stay live for one phase.
- `CHANGELOG.md` lists every shape change with the phase it landed.
