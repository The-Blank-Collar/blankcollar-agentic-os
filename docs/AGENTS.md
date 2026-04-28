# Agents

How agents are modelled in Blank Collar, and the contract every agent adapter must implement.

## Mental model

> An agent is not a process. It is a hire.

That framing matters. Operators *hire* and *fire* agents the same way they would humans:

- Hiring an agent creates a row in `ops.agent`, gives it a name, sets its config, and marks it `is_active=true`.
- Firing an agent flips `is_active` to `false`. The row stays for audit. Memories created by it remain in the brain.

## Kinds shipping with the OS

| Kind        | Folder              | Strength                                         | Phase |
|-------------|---------------------|--------------------------------------------------|-------|
| `hermes`    | `apps/hermes`       | General-purpose reasoning & writing              | 3     |
| `openclaw`  | `apps/openclaw`     | Tool calling, browser use, computer use          | 3     |
| `<future>`  | `apps/<name>`       | Specialized adapters (e.g. coding, research)     | TBD   |

You add a new kind by creating a new adapter folder that satisfies the contract below. No core code changes needed.

## The Adapter Contract

Every adapter is an HTTP service exposing **exactly** these endpoints:

```
POST /run
GET  /run/{id}
POST /run/{id}/cancel
GET  /healthz
```

Full request/response shapes are in [`API.md`](API.md#agent-adapter-contract-l3).

### `/run`

Receives `{ goal_id, run_id, input, scope }`. Returns `202` immediately and works asynchronously. The adapter is **not** allowed to block until completion.

### `/run/{id}`

Returns the current status. Paperclip polls this; agents may also push status to Paperclip's stream endpoint as a courtesy.

### `/run/{id}/cancel`

Best-effort cancel. Adapters must not leak resources if cancel arrives mid-flight.

### `/healthz`

Returns `200` with `{ "ok": true, "version": "<semver>" }`. Used by `doctor.sh` and Docker healthchecks.

## What every adapter must do

1. **Honour the scope.** Every call to `gbrain` and every skill invocation passes the original `scope` unchanged.
2. **Use `gbrain` for memory.** Adapters must not maintain their own long-term memory store. Persistent context lives in the Brain.
3. **Use the policy engine for tools.** Direct calls to user data, third-party APIs, file system, etc. must go through the L2 policy gate (Phase 5+).
4. **Stream updates.** Push log lines and tool-call markers to `POST /api/runs/{run_id}/events` so the dashboard feels alive.
5. **Cap cost.** Each run gets a soft and hard cost ceiling from Paperclip in `input.budget`. Adapters must respect both.
6. **Idempotency.** Receiving the same `run_id` twice must not produce two runs.

## What every adapter must NOT do

1. Talk to other agents directly. Multi-agent flows are coordinated by Paperclip, not via peer-to-peer chatter.
2. Ignore `cancel`. A run that won't stop must escalate, not silently keep going.
3. Persist secrets. Receive them per-run via `input` or fetch via the policy engine; never write to disk.
4. Cross org boundaries. A run scoped to org A must never read from org B's brain — the scope check is non-negotiable.

## Configuration

`ops.agent.config` is a JSON blob whose shape is owned by the adapter. Conventional keys:

```json
{
  "model": "claude-sonnet-4-6",
  "temperature": 0.2,
  "system_prompt_preset": "marketing-lead",
  "tools_allowed": ["web_search", "send_email"],
  "budget_per_run_cents": 50
}
```

Adapters must validate this on startup and on every config edit. Invalid config = the agent stays inactive and surfaces an error to the dashboard.

## Adapter examples (Phase 3)

- **`apps/hermes/`** wraps the official Hermes runtime. Translates `/run` into Hermes's native task spec.
- **`apps/openclaw/`** wraps OpenClaw with the necessary browser-context bootstrapping.

A future `apps/<custom>/` could wrap LangGraph, CrewAI, a custom Python loop, or a fine-tuned model — provided it implements the contract.

## Lifecycle: hire → run → fire

```
[hire]    POST /api/agents          → row in ops.agent (is_active=true)
[run]     POST /goals/{}/dispatch   → row in ops.run; adapter executes
                                     → memories written via gbrain
                                     → audit_log entries
[fire]    PATCH /api/agents/{id}    → is_active=false, runs preserved, brain preserved
```

Firing **does not** delete past runs or memories. To wipe an agent's memories explicitly, an owner can issue a `gbrain.forget` over the agent's memory set — that's an explicit, audited operation.
