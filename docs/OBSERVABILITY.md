# Observability

What we can see, who can see it, and how we plan to keep an agentic system honest.

## The three signals

| Signal       | Phase 0 today                    | Where it goes long-term                                        |
|--------------|----------------------------------|----------------------------------------------------------------|
| **Logs**     | `docker compose logs`            | Structured JSON, shipped to a log store from Phase 4+          |
| **Metrics** | None yet                          | Prometheus-compatible endpoint per service from Phase 2+       |
| **Traces**  | None yet                          | OpenTelemetry spans from Phase 2+, with run_id as trace_id     |

A run is the natural unit of observation. Every log line, metric, and span tied to a run carries the `run_id` so you can pivot from "this run failed" to "show me everything that happened" with one click.

## Logging conventions (target)

Every service logs structured JSON, one event per line:

```json
{
  "ts": "2026-04-28T10:23:11.412Z",
  "level": "info",
  "service": "paperclip",
  "env": "local",
  "run_id": "<uuid|null>",
  "goal_id": "<uuid|null>",
  "actor_id": "<uuid|null>",
  "actor_role": "owner",
  "event": "run.dispatched",
  "msg": "Run queued for hermes",
  "data": { "agent_id": "..." }
}
```

Rules:

- **No `console.log`.** Use the shared logger from `packages/shared` (Phase 1+).
- **No PII in `msg` or `event`.** PII goes inside `data`, where it's filtered at the log shipper.
- **Levels mean things:** `error` = something is wrong and a human should look; `warn` = degraded but recovering; `info` = state changes; `debug` = developer-only.

## Metrics (target)

Phase 2+ will expose `/metrics` per service. Headline metrics:

- `bc_runs_total{status,agent_kind,department}` — counter
- `bc_run_duration_seconds{agent_kind}` — histogram
- `bc_run_cost_cents{agent_kind,department}` — histogram
- `bc_memory_writes_total{kind,department}` — counter
- `bc_memory_recalls_total{kind,role}` — counter
- `bc_skill_invocations_total{skill,policy_decision}` — counter
- `bc_approvals_pending` — gauge

A small dashboard pinned to: active goals, runs/hr, last-24h cost, pending approvals.

## Tracing (target)

Phase 2+ adopts OpenTelemetry. Span layout for a run:

```
goal.dispatch  (root span, trace_id = run_id)
└── agent.run
    ├── gbrain.recall
    ├── llm.completion
    ├── skill.invoke (× many)
    └── gbrain.remember (× many)
```

Spans propagate `actor_id`, `actor_role`, and `goal_id` as attributes. This makes "show me every external call this goal made" a single trace query.

## The audit log is part of observability

`core.audit_log` is the **canonical record of what changed**. Logs and metrics are best-effort; the audit log is durable.

- Every state mutation in `ops` and `brain` writes a row.
- Auditors get read-only access org-wide.
- The dashboard's "activity" view in Phase 4 is rendered from audit + the run stream.

## Cost observability

Agentic systems are uniquely good at burning money. Track:

- **Per-run cost** — emitted at `run.finished`. Stored on `ops.run.metadata.cost_cents`.
- **Per-goal rolling cost** — sum of run costs.
- **Per-department monthly spend** — surfaced on the dashboard.
- **Soft and hard caps** — soft cap warns the dashboard; hard cap aborts the run.

## Privacy & retention

- Logs ship with PII fields **masked** (emails → `<email>`, names → first letter).
- Audit log retention defaults to 365 days; configurable per org from Phase 6+.
- Brain memories are never copied into logs. Logs reference `memory_id` only.

## Today's "how do I see what's happening?" cheat sheet

```bash
docker compose ps                          # service status
docker compose logs -f paperclip           # live tail one service
docker compose logs --tail=200 --no-color  # last 200 lines, all services
psql "$DATABASE_URL" -c "SELECT count(*) FROM core.audit_log;"   # nothing yet
curl -s http://localhost:6333/dashboard    # Qdrant UI
```

When Paperclip lands in Phase 2, the dashboard's *Activity* tab becomes the first stop instead of any of the above.
