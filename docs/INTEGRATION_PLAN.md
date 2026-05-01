# Backend Integration Plan — Four Cs extension on the existing pipeline

This doc shows how the new modules (Skills Engine, Routines Engine, Onboarding, Self-Improvement, Knowledge wiki, Google Workspace connectors) wire into the system that already exists, what the data flows look like, and the order migrations apply on a running install.

> **Scope.** Backend only. The temporary htmx UI in Paperclip stays the way it is until the custom React console replaces it. Every API surface below is mode-aware (single-user / multi-user) and respects existing role-scoped access.

## 1. The Four Cs ↔ existing services

| Pillar          | What it answers          | Existing service                                  | New code added                                                                |
|-----------------|--------------------------|---------------------------------------------------|-------------------------------------------------------------------------------|
| **Context**     | What does it know?       | `gbrain` (Qdrant), `Graphiti` (Neo4j), audit_log  | `apps/paperclip/src/knowledge/` + `ops.knowledge_doc` + `/api/knowledge/*`    |
| **Connections** | What can it reach?       | Nango, `apps/email-ingest`                        | `apps/paperclip/src/connectors/google.ts` + `google.*` skill manifests       |
| **Capabilities**| What can it do?          | OpenClaw skills, Hermes prompts, LangGraph router | `packages/skills/manifests/` + `apps/paperclip/src/skills/{loader,registry}` + `/api/skills/*` |
| **Cadence**     | When does it act?        | Existing `apps/paperclip/src/scheduler.ts` (cron) | `apps/paperclip/src/routines/triggers.ts` (event/api) + `/api/routines/*`    |

Cross-cutting:

- **Onboarding** drives the *Four Cs* — interview answers determine which skills to enable, which routines to start, which knowledge docs to seed.
- **Self-Improvement** closes the loop — weekly audit reads the audit_log; level-up suggests new routines / skills / governance, applied with one click.

## 2. Data model — additive, idempotent migrations

All new tables live in the `ops` schema and follow the same RLS pattern as the existing tables (FORCE ROW LEVEL SECURITY, policy `app_scope_org` reading the session GUC `app.org_id`). Migrations apply on every Paperclip boot via `applyAdditiveMigrations()` in `apps/paperclip/src/bootstrap.ts`, so existing dev volumes pick them up without `make reset`.

| Table                       | Purpose                                                               | Pillar       |
|-----------------------------|-----------------------------------------------------------------------|--------------|
| `ops.skill`                 | Skill manifest registry — mirrors YAML files into queryable rows      | Capabilities |
| `ops.routine_trigger`       | Schedule / event / api triggers for routine goals                      | Cadence      |
| `ops.onboarding_profile`    | Interview answers + derived auto-config                                | —            |
| `ops.audit_report`          | Self-audit + level-up reports                                          | —            |
| `ops.knowledge_doc`         | Markdown wiki docs (personal/company/shared, hot-context flag)         | Context      |
| `ops.knowledge_link`        | Backlinks/wikilinks parsed from doc bodies                             | Context      |

New enums: `ops.skill_scope`, `ops.routine_trigger_kind`, `ops.onboarding_mode`, `ops.audit_report_kind`, `ops.knowledge_scope`. Plus `ops.run.acknowledged_at` for inbox dismissal (already shipped).

Backward compat: zero breaking changes. Every existing column / table is unchanged. New tables and columns are additive.

## 3. End-to-end data flow per pillar

### Capabilities — invoking a skill

```
                  ┌────────────────┐
                  │ user / agent   │
                  │ POST           │
                  │ /api/skills/   │
                  │   :slug/invoke │
                  └───────┬────────┘
                          ▼
        ┌─────────────────────────────────────┐
        │ Paperclip::routes/skills.ts          │
        │   1. resolveCallerScope              │
        │   2. SELECT FROM ops.skill           │
        │      (org_id NULL OR org_id = scope) │
        │   3. INSERT ops.goal kind=ephemeral  │
        │   4. INSERT ops.run status=queued    │
        │   5. audit('skill.invoke')           │
        └───────┬─────────────────────────────┘
                ▼
   ┌────────────────────────────────┐
   │ Paperclip::queue/worker.ts     │   (existing)
   │ picks queued run               │
   │ dispatches to agent_kind       │
   └───────┬────────────────────────┘
           ▼
   ┌────────────────────────────────┐
   │ Hermes / OpenClaw / LangGraph  │   (existing — adapter contract unchanged)
   │ POST /run                      │
   │ executes with input.skill      │
   └───────┬────────────────────────┘
           ▼
   ┌────────────────────────────────┐
   │ gbrain /remember               │   (existing)
   │ writes episode/document        │
   └────────────────────────────────┘
```

The agent never has to know the skill comes from a manifest vs. an inline subtask — the run input is the same shape (`{ skill, agent_kind, inputs }`). LangGraph's classifier-then-route logic is unchanged.

### Cadence — three trigger paths fire the same routine goal

```
schedule (existing)            event (new)                    api (new)
──────────────                 ───────────                    ─────────
scheduler.tick()               scheduler.fireEventTriggers()  POST /api/routines/triggers/:id/fire
  └ parseCron + firedInWindow    └ scan core.audit_log        └ verify endpoint_token
                                  └ matchesEvent(spec, ev)
        \                       /                            /
         └─────────┬───────────┴────────────────────────────┘
                   ▼
        routines/triggers.ts::fireRoutineFromTrigger()
                   │
                   ▼
        generatePlan(goal) ─────► INSERT ops.run (status=queued)  × N subtasks
                                  audit('run.dispatch')
                                  UPDATE ops.routine_trigger SET last_fired_at = now()
```

Single pipeline, three entry points. The worker picks up queued runs the same way it always has.

### Context — Hermes pre-loads hot wiki + recall + Graphiti

```
Hermes /run starts
  ├ GET /api/knowledge/hot      → preload markdown into system prompt (caller scope)
  ├ POST /remember (gbrain)     → episodic write before/after (existing)
  ├ POST /recall (gbrain)       → semantic recall (existing)
  └ POST /search (graphiti)     → temporal facts (existing)
```

The wiki lives in Postgres (queryable, indexable, RLS-scoped). On every doc create/update Paperclip also pushes the markdown to gbrain as a `kind=document` memory so Qdrant recall finds it. Backlinks are parsed and stored in `ops.knowledge_link` — no Graphiti dependency for v0; the Graphiti-canonical wiki graph is a Phase-5 follow-up.

### Onboarding → auto-config

```
POST /api/onboarding/start  (mode=single_user|multi_user)
  └ ops.onboarding_profile  row created (or resumed)

repeat:
  GET  /api/onboarding/questions   → next batch
  POST /api/onboarding/answer      → store, get next

POST /api/onboarding/finish
  └ deriveFromAnswers(answers, mode)
       ├ extracts: voice_words, banned_words, briefing_hour, channels,
       │           routine_hints, decision_categories, departments
       ├ INSERT ops.goal (kind=routine, draft) × N      ← cadence seed
       ├ INSERT ops.knowledge_doc (hot=true)            ← context seed
       └ audit('onboarding.finish')
```

Single-user: 7 questions, no departments. Multi-user: same 7 (re-keyed C1–C7) for the company track + 4 individual questions per teammate. Every answer is replayable by re-running `deriveFromAnswers()` against the stored array — useful when the heuristic improves.

### Self-Improvement loop

```
weekly cron (via routine goal, see seeds in onboarding):
  POST /api/self/audit           ← composes from ops.run, ops.goal, ops.capture, audit_log
    └ INSERT ops.audit_report kind=audit
  POST /api/self/level-up        ← reads latest audit, proposes apply_action payloads
    └ INSERT ops.audit_report kind=level_up

POST /api/self/reports/:id/apply
  └ marks suggestions as applied (UI / future operator eventually executes them)
```

Mode-aware: in multi-user mode `user_id` scopes the audit to one teammate. The heuristic v0 makes templated suggestions; the `narrate()` helper upgrades to LLM prose when `ANTHROPIC_API_KEY` is set, just like the daily briefing.

### Connections — Google Workspace via Nango

```
Skill manifest (e.g. google.calendar.create_event.yaml)
  agent_kind: openclaw

Run dispatched to OpenClaw with input.skill = "google.calendar.create_event"
  └ OpenClaw resolves the connectionId for the caller (single_user: lone user;
    multi_user: from skill input or team mapping)
  └ Calls connectors/google.ts (currently in Paperclip; mirror in OpenClaw next session)
       └ POSTs to Nango /proxy with Provider-Config-Key=google
             └ Nango handles OAuth, rate limits, token refresh
                   └ Returns Google API response

Result writes back to gbrain as a document memory (existing).
```

`apps/paperclip/src/connectors/google.ts` is the *typed convenience layer* — Gmail search, Calendar create, Drive search, Docs append, Sheets append. The skill manifests in `packages/skills/manifests/shared/google.*.yaml` declare the contract. OpenClaw will absorb the connector module in its next iteration; for now Paperclip exposes the same capability via skill.invoke and the run pipeline.

## 4. Mode-awareness — single bit, two products

Every component reads the active mode from one signal:

- **Single-user:** the personal org (slug = `blankcollar-personal` after `make personal`) has exactly one user with role=`owner`, dept=`NULL`. `OnboardingProfile.mode = 'single_user'`. Skills with `mode_aware: true` default to the safer behaviour (e.g. `email.send` defaults to *draft only*).
- **Multi-user:** the org has multiple users + departments + role assignments. `OnboardingProfile.mode = 'multi_user'`. Skills run under the caller's role; governance gates apply.

The data model is the same. The mode flips two things:
1. The onboarding question bank (7 personal vs 7 company + 4 individual).
2. Mode-aware skill defaults (today: email-send "draft only" in single-user).

Adding new mode-aware behaviour is one branch on `mode` plus a manifest tag — never a new table.

## 5. Migration order on a running install

`applyAdditiveMigrations()` is idempotent and ordered. On every Paperclip boot:

1. Existing migrations apply (goal kind enum, KRs, briefings, captures, RLS) — already shipped.
2. **New:** create `ops.skill_scope`, `ops.skill`, indexes.
3. **New:** create `ops.routine_trigger_kind`, `ops.routine_trigger`, indexes.
4. **New:** create `ops.onboarding_mode`, `ops.onboarding_profile`, unique index.
5. **New:** create `ops.audit_report_kind`, `ops.audit_report`, indexes.
6. **New:** create `ops.knowledge_scope`, `ops.knowledge_doc`, `ops.knowledge_link`, indexes.
7. **New:** ENABLE / FORCE ROW LEVEL SECURITY + `app_scope_org` policies on every new table.
8. After migrations: `syncSkillRegistry()` reads `packages/skills/manifests/` and upserts every `shared` manifest into `ops.skill` with `org_id=NULL`.

Rollback: every migration is `IF NOT EXISTS` / `EXCEPTION WHEN duplicate_object` so re-running is safe. There is no destructive step. Removing a feature = drop the routes + drop the tables manually.

## 6. New API surface (one-page reference)

```
SKILLS         GET    /api/skills                      list available
               GET    /api/skills/:slug                manifest
               POST   /api/skills/:slug/invoke         dispatch a run

ROUTINES       GET    /api/goals/:id/triggers          list triggers
               POST   /api/goals/:id/triggers          add schedule|event|api trigger
               PATCH  /api/routines/triggers/:id       edit
               DELETE /api/routines/triggers/:id       remove
               POST   /api/routines/triggers/:id/fire  manual / api-token fire

ONBOARDING     POST   /api/onboarding/start            begin or resume
               GET    /api/onboarding/questions        next batch
               POST   /api/onboarding/answer           store one answer
               POST   /api/onboarding/finish           apply derived config
               GET    /api/onboarding/profile          current profile

SELF-IMPROVE   POST   /api/self/audit                  run audit now
               POST   /api/self/level-up               propose changes
               GET    /api/self/reports                history
               POST   /api/self/reports/:id/apply      mark applied

KNOWLEDGE      GET    /api/knowledge                   list (filter by scope, hot, tag, q)
               GET    /api/knowledge/hot               hot-context docs (Hermes pre-loads these)
               GET    /api/knowledge/:slug             doc + backlinks + outbound links
               POST   /api/knowledge                   create
               PATCH  /api/knowledge/:id               update
               DELETE /api/knowledge/:id               delete
```

All endpoints now run inside `withOrgScope(scope.org_id, ...)` — the GUC `app.org_id` is bound for the duration of every request's transaction, so the RLS policies have something to match against. The policies still keep their permissive-when-unset branch as a safety net; flipping it to strict is the Phase-B work below.

### Phase B — RLS strict flip (deferred, single bounded session)

Swap the `app_scope_org` policy expression from
```
USING (current_setting('app.org_id', true) IS NULL
       OR current_setting('app.org_id', true) = ''
       OR org_id::text = current_setting('app.org_id', true))
```
to
```
USING (org_id::text = current_setting('app.org_id', true))
```

Two known follow-ups before flipping:
1. **Worker** (`apps/paperclip/src/queue/worker.ts`) and **Scheduler** (`apps/paperclip/src/scheduler.ts`) iterate goals across orgs — they need per-iteration `withOrgScope(goal.org_id, ...)` so each run/fire is scoped to its own org.
2. **Boot migrations** (`applyAdditiveMigrations`) run schema DDL with no scope — that's correct (DDL bypasses RLS) but needs to stay outside `withOrgScope`.

## 7. Logging + observability

Every mutation continues to write to `core.audit_log` via the shared `audit()` helper. New action namespaces added by this extension:

- `skill.invoke`
- `routine.trigger.{create|update|delete|fire}`
- `onboarding.{answer|finish}`
- `self.{audit.run|level_up.run|report.apply}`
- `knowledge.{create|update|delete}`

The audit log feeds the existing `/api/heartbeat` ("activity" series), the Self-Improvement audit composer (recent events), and the event-trigger matcher in the scheduler.

## 8. What lands later (deliberately deferred)

- **Approval queue** for skills with `permissions.approval_under` thresholds (Phase 5 policy engine).
- **Hot-reload of skill manifests** without a Paperclip restart.
- **Graphiti-backed knowledge graph** (replacing `ops.knowledge_link` for richer relationships).
- **OpenClaw absorbing `connectors/google.ts`** so Workspace skills run without a Paperclip-side proxy hop.
- **Per-user briefing timezones** — currently `PAPERCLIP_BRIEFING_HOUR_UTC` is a single global.
- **Approval inbox** for agent-requested approvals (today only the user-facing decision-resolve path exists).

## 9. Verifying end-to-end

```bash
# bring up the stack with the new schemas + skills
make bootstrap

# check the skill registry synced
docker exec -i bc_postgres psql -U postgres -d blankcollar -c "
  SELECT slug, version, scope, agent_kind FROM ops.skill ORDER BY slug;
"

# run the onboarding flow against single-user
curl -sX POST localhost:3000/api/onboarding/start \
  -H 'content-type: application/json' \
  -d '{"mode":"single_user","user_email":"you@example.com","user_name":"You"}' | jq

# add a routine via capture (existing)
curl -sX POST localhost:3000/api/capture \
  -H 'content-type: application/json' \
  -d '{"raw_content":"Every Monday morning summarise the weekend."}' | jq

# bind an event trigger to a goal (e.g. fire on every approval)
GOAL_ID=$(curl -s localhost:3000/api/goals?kind=routine | jq -r '.[0].id')
curl -sX POST localhost:3000/api/goals/$GOAL_ID/triggers \
  -H 'content-type: application/json' \
  -d '{"trigger_kind":"event","trigger_spec":{"action":"decision.approve"}}' | jq

# run a self-audit on the last 7 days
curl -sX POST localhost:3000/api/self/audit \
  -H 'content-type: application/json' \
  -d '{"period_hours":168,"kind":"audit"}' | jq '.summary_md'

# create a hot wiki doc Hermes will preload
curl -sX POST localhost:3000/api/knowledge \
  -H 'content-type: application/json' \
  -d '{"slug":"governance","title":"Governance","scope":"company","hot":true,"content_md":"# Governance\n\nApprove [[brand-voice]]"}' | jq
```

`make doctor` continues to pass — the new modules add no new external dependencies (Nango is already wired; Anthropic is optional). 77 vitest cases cover the pure-function layers (cron parser, briefing-hour boundary, capture classifier, sigil seed, skills loader, derive heuristics, wikilink extraction, event matcher).
