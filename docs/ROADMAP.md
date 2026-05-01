# Roadmap

A phased plan from groundwork to public launch. Each phase ends with something demoable.

## Phase 0 — Groundwork *(now)*

**Goal:** anyone can clone the repo and have the whole stack running on their Mac in under 5 minutes.

- [x] Monorepo scaffold (`apps/`, `packages/`, `infra/`, `docs/`)
- [x] `docker-compose.yml` with Postgres + Qdrant + 4 placeholder services
- [x] `init.sql` schema for `core`, `ops`, `brain`
- [x] `.env.example` covering current + future phases
- [x] `bootstrap.sh`, `doctor.sh`, `reset.sh`
- [x] README, ARCHITECTURE, GOAL_FIRST, ROLES, COMPANY_BRAIN, LOCAL_SETUP, QA_CHECKLIST
- [x] CI lint workflow

## Phase 1 — Real Memory Layer ✅

**Goal:** `gbrain` is no longer a placeholder; agents can `/remember` and `/recall`.

- [x] gbrain HTTP service (Python · FastAPI · pydantic v2 · asyncpg · qdrant-client)
- [x] Embedding pipeline (default `text-embedding-3-small`; deterministic fake fallback when no API key)
- [x] Qdrant collection bootstrap (one collection per `(org, kind)`, lazy-created)
- [x] Role-scoped recall queries (owner/auditor read-all; team_member/agent gated by `visible_to`)
- [x] Audit-log integration on remember/forget (writes to `core.audit_log`)
- [x] Unit tests for the scope filter (16 tests, the security-critical pure function)
- [x] Dockerfile + docker-compose integration; `doctor.sh` checks `/healthz`
- [x] CI job: ruff lint + pytest + image build
- [ ] CLI: `bc memory remember "fact" --dept=marketing` *(deferred to Phase 2 alongside Paperclip CLI)*

## Phase 2 — Paperclip Orchestrator ✅

**Goal:** create goals via API; runs are dispatched (against fake agents) and visible.

- [x] Paperclip HTTP API (goals, runs, agents, audit, plan/dispatch) — `docs/API.md`
- [x] Run queue (Postgres-backed `FOR UPDATE SKIP LOCKED`, in-process worker)
- [x] Agent registry CRUD (`ops.agent`) — hire / update / fire endpoints
- [x] Goal-first dashboard at `/` — server-rendered, htmx-driven
- [x] Built-in fake agent that writes an `episode` memory to gbrain (proves L1↔L4 wiring)
- [x] Audit-log entries on every state change
- [x] Vitest tests, typecheck, Docker image, CI job
- [ ] WebSocket for live run telemetry *(deferred to Phase 3 — polling works for v0)*

## Phase 3 — First Real Workforce ✅

**Goal:** an end-to-end demo: create a goal → real agent does the work → result visible in dashboard.

- [x] Hermes adapter (real Python/FastAPI container, full adapter contract)
- [x] OpenClaw integration (real Python/FastAPI container, full adapter contract)
- [x] Adapter HTTP client + registry on Paperclip (`http://hermes:80`, `http://openclaw:80`)
- [x] In-process fake-agent retired; worker now polls real adapters until terminal
- [x] Default Hermes + OpenClaw rows auto-inserted into `ops.agent` on Paperclip startup
- [x] Plan generator recognises URLs in goals → fetch → summarise → decision
- [x] "Run plan" button dispatches all subtasks at once
- [x] Skills (v0): `web.fetch` (politeness controls + IP-literal safety)
- [x] Demo goal works: *"Summarize https://news.ycombinator.com/ for me."*
- [ ] Email send skill *(deferred to Phase 5 alongside the policy engine)*
- [ ] WebSocket telemetry *(deferred — polling is sufficient for v0)*

## Phase 3.5 — Backend Tightening (single-user first) ✅ in progress

**Goal:** lock the API contract before the React console handoff. Soften the goal-first language without breaking the goal-first model.

- [x] `ops.goal` gets a `kind` enum (`ephemeral` | `standing` | `routine` | `decision`)
- [x] `ops.goal` first-class columns: `cron_expr`, `due_at`, `progress`, `target_value`, `actual_value`, `delta_label`, `track_state`
- [x] `ops.key_result` table + CRUD routes; embedded in `GET /api/goals/:id`
- [x] `ops.goal_contributor` table (humans + agents per goal)
- [x] `ops.briefing` table + `/api/briefing/today`, `/api/briefing/generate` (templated v0)
- [x] `ops.capture` table + `POST /api/capture` (the user's verb) with heuristic classifier
- [x] Idempotent additive migrations apply on every Paperclip boot
- [x] `GET /api/inbox` — decisions / blocked / drafts feed, urgency-ordered
- [x] `GET /api/heartbeat` — 14-day system pulse (captures, runs, goals, activity)
- [x] `GET /api/agents/:id/state` — live / idle / warn + current activity + sigil seed
- [x] `POST /api/goals/:id/resolve` — approve/decline a decision goal
- [x] `GET /api/brain/graph` — synthesised nodes + edges for the constellation page
- [x] Hermes-narrated briefings (Anthropic-direct, brand voice, templated fallback)
- [x] In-process routine scheduler — fires `kind=routine` goals on `cron_expr`
- [x] `make personal` — single-user bootstrap with personal org + default agents
- [x] Email-ingest service activated — IMAP poller writes conversation memories + POSTs actionable mail to `/api/capture`
- [x] RLS policies on `ops.*`, `brain.memory`, `core.audit_log` — bound to session GUC `app.org_id` via `withOrgScope()`. Permissive default until routes migrate.
- [x] Scheduled daily briefing — auto-fires once per UTC day at `PAPERCLIP_BRIEFING_HOUR_UTC` per active org
- [x] Inbox `routine_output` distinct from `draft` — UI can render "your Monday digest is ready" vs generic drafts
- [x] Inbox dismissal — `POST /api/inbox/acknowledge/:goal_id` marks runs seen so items stop surfacing
- [x] **Four Cs extension** — Skills Engine, Routines Engine (event/api triggers), Onboarding interview, Self-Improvement (Audit + Level-Up), Knowledge wiki, Google Workspace connectors (see `docs/INTEGRATION_PLAN.md`)
- [x] Approval queue — `ops.approval` + `/api/approvals/*` + surface in inbox; agent ↔ human pause-and-decide protocol
- [x] Webhook capture intake — `POST /api/webhooks/capture` HMAC-verified; arbitrary externals drop into the capture pipeline
- [x] Channels presence — `GET /api/channels` over Nango connections + sentinel rows for email and webhook
- [x] Hermes-driven capture classifier — LLM call when `ANTHROPIC_API_KEY` set, heuristic stays as fallback
- [x] Brain graph TTL cache (30s) + `/api/health` enrichment (probes hermes/openclaw/workspace + counts)
- [x] **`bc` CLI** — `packages/cli/`: terminal-side wrapper for every endpoint, editorial output for humans + JSON for pipes (`make cli`)
- [x] **withOrgScope route migration (Phase A)** — every route handler now binds `app.org_id` for the duration of its DB access. No behaviour change yet (policies still permissive); foundation for Phase B.
- [x] **OpenClaw Google Workspace connectors** — `apps/openclaw/app/google_workspace.py` + runner dispatch for `google.gmail.search` / `google.calendar.create_event` / `google.drive.search` / `google.docs.append` / `google.sheets.append_row`. Skills declared in Phase 3.5 now actually execute end-to-end through Nango.
- [x] **withOrgScope Phase B foundation** — worker + scheduler + bootstrap migrated to per-iteration `withOrgScope(goal.org_id, ...)`. The lifecycle of every run, routine fire, and briefing now binds the right scope. Cross-org scans (worker claim, audit-event scan, org list) intentionally stay outside scope; the strict-RLS policy flip needs a privileged path (BYPASSRLS role or SECURITY DEFINER fn) for those scans.
- [x] **KR completion auto-detection** — `skills/kr_progress.ts` parses free-form numeric values ($1.2M, 10k, 85%); KR PATCH recomputes goal.progress and stamps `delta_label='achieved'` when the rollup hits 100%.
- [x] **Per-user briefing timezones** — `ops.briefing.user_id` column + scheduler reads `onboarding_profile.derived.briefing_hour_utc` per user and fires personal briefings at each user's preferred hour, alongside the org-level one.
- [x] **SSE run telemetry** — `GET /api/runs/:id/stream` emits Server-Sent Events on every status / output / error change, plus a final `done` event. Hard 10-minute timeout. CLI exposes via `bc run <id> --watch`.
- [x] **`bc runs` + `bc run` CLI commands** — list runs by goal, view single run, stream live status with `--watch`.
- [x] **Auto-weekly self-audit routine** — `make personal` seeds a `kind=routine` goal "Weekly self-audit" with cron `0 9 * * 1`. Closes the self-improvement loop without operator wiring.
- [x] **CLI surface fan-out** — `bc routines / triggers / fire` (manage cron + event + api routines), `bc inbox --summary` and `bc approvals --summary` (count-only badges), `bc search` (cross-corpus over goals/captures/knowledge/agents, ILIKE-based), `bc tail` (org-wide activity feed), `bc heartbeat` (block-character sparklines), `bc logs` (audit log viewer), `bc whoami`, `bc depts`, `bc close|pause|resume|archive <goal_id>`, `bc kr list|add|set|rm`, `bc capture --kind=<k>`, `bc briefing list`, `bc skills --scope|--agent`, `bc routines` shows next-cron-fire client-side. All subcommands honour `--json` / `--pretty`.
- [x] **Stats + summary endpoints** — `GET /api/goals/summary` (kind/status rollup + stalled count), `GET /api/goals/:id/stats` (per-goal run rollup), `GET /api/agents/:id/stats` (per-agent lifetime rollup), `GET /api/activity` (org-wide chronological feed), `GET /api/inbox/summary`, `GET /api/approvals/summary`, `GET /api/whoami`, `GET /api/departments`, `GET /api/search`. All derived views over existing tables — no schema changes.
- [x] **Stalled-goals filter** — `GET /api/goals?stalled_for_days=N` returns active/draft goals with no recent run activity; backs `bc goals --stalled[=N]`.
- [x] **withOrgScope Phase B foundation** — `withSystemScope()` helper + `app_system_scope` PERMISSIVE policy on every RLS-enabled table. Worker run-claim, scheduler scans (routines/event-triggers/per-user briefings/missing-briefings), and health counts now run under system scope. Webhook capture migrated to `withOrgScope`.
- [ ] **withOrgScope Phase B flip** — tighten `app_scope_org` to drop the permissive-on-unset branch (`IS NULL OR = ''`). Requires a full callsite audit first; deferred until every route is provably scoped.

## Phase 4 — Goal Command Centre

**Goal:** the dashboard becomes the *thing*. Goal-first UX, not API-first. The console replaces Paperclip's htmx UI; built against the Phase-3.5 contract.

- [ ] Vite + React console at `apps/website/` (Swiss editorial, dark-first)
- [ ] Capture-first input ("what's on your mind") instead of "create a goal"
- [ ] Daily briefing as the front door (replaces the goals list as default)
- [ ] Goal cards differentiated by `kind` (decision card / routine card / standing card)
- [ ] Drill-down to runs and (only on demand) raw agent traces
- [ ] Mobile-friendly read view (deferred until desktop ships)

## Phase 5 — Intelligence Layer

**Goal:** add new capabilities by configuration, not code.

- [x] Skills catalog (registry + manifests live in `packages/skills/`)
- [ ] MCP tool registry — `ops.tool` table + manifest loader for local MCP servers
- [x] **Policy engine `(role, agent_kind, skill_slug, action_kind) → allow|approve|deny`** — `ops.policy` table, evaluator, `/api/policies` CRUD + `/policies/evaluate` dry-run, wired into `/skills/:slug/invoke` (deny → 403, approve → 202 with approval row, allow → existing queue path). Approval-effect path round-trips: approving the resulting `ops.approval` queues the run from the cached proposal.
- [x] Approval inbox for human-in-the-loop tools (in `/api/inbox`, surfaced as `item_kind=approval`)

## Phase 6 — Auth & Multi-Tenancy

**Goal:** more than one user, more than one org, real role enforcement.

- [ ] Supabase integration
- [ ] Org / department / user CRUD UI
- [ ] Invite flows
- [ ] Audit log explorer

## Phase 7 — Payments & Onboarding

**Goal:** a stranger lands on the marketing site and ends up running their own agent company.

- [ ] Stripe billing
- [ ] Onboarding wizard (paste your goals → we wire up the departments)
- [ ] `agent@blankcollar.ai` inbound email pipeline
- [ ] Hosted tier gated behind subscription

## Phase 8 — Public Launch

**Goal:** www.blankcollar.ai opens to the public.

- [ ] Marketing site
- [ ] Skill marketplace
- [ ] Templates ("Solo Creator OS", "Two-Person SaaS OS", "Agency OS")
- [ ] First 100 users

## Phase 9 — Agent Payments (Outbound Spend Layer)

**Goal:** agents can safely spend money on the user's behalf — book flights, pay vendors, buy tools — with hard guardrails the agents themselves cannot bypass. Distinct from Phase 7's inbound Stripe billing (user → us); this is outbound spend (us → vendors).

**Build order (strict, mirrors the design brief):**

1. README update — Stripe Payments integration overview + safety design philosophy
2. Data models — `PaymentSettings`, `PaymentRequest`, `AgentSpendingLimit`, `Approval` (extension), `TransactionLog`, `Vendor`, `Category`, `KillSwitchEvent`
3. **Payment Settings backend** — enable/disable, limits, rules, per-agent controls, kill switch
4. **Policy Engine** with hard enforcement (no agent or skill can override)
5. **Stripe connector service** — Link Wallets + Issuing + MPP + SPT + Stripe Projects (May 2026 product set)
6. **Finance Agent** (LangGraph) — only handles payments, strictly follows policies
7. **Approval workflow** — multi-channel notify, wait, execute, log
8. **Graphiti integration** — scoped logging of every payment + decision
9. **Skills + Cadence integration** — payment skills routed through the engine; weekly spending summary as a routine
10. **Comprehensive testing plan** — overspending protection, edge cases, multi-user, security, integration

### Components

**Payment Settings (mode-aware):**
- Global on/off toggle (account-level for single user, company-level for multi-user)
- Daily / weekly / monthly hard caps (cannot be bypassed by any agent or skill)
- Approval rules: auto-approve under $X, manual approve above $Y, per-category overrides
- Per-agent permissions: enable/disable, individual limits, allowed categories/vendors
- Emergency kill switch — instant pause + revoke all active tokens/cards
- Audit + transparency: filterable transaction history, daily/weekly/monthly reports, export

**Safety Guardrails (defense in depth):**
- Hard spending caps enforced at the DB layer, not just the policy layer
- Confirmation gate on high-risk transactions even when auto-approve would otherwise apply
- Velocity checks — block unusual rapid-fire spending patterns
- Vendor + category whitelist / blacklist
- Short-lived tokens and virtual cards (issued per-task, expire fast)
- Real-time balance check before every payment attempt
- Multi-user safeguards: department budgets, role-based approval thresholds, company-wide visibility for owners/auditors

**Stripe products (May 2026):**
- Link Wallets for agents (one-time-use cards + Shared Payment Tokens)
- Stripe Issuing for agents (virtual cards with controls)
- Machine Payments Protocol (MPP)
- Shared Payment Tokens (SPT)
- Stripe Projects for scoped credentials per agent / department

**Approval flow:**
1. Agent creates `PaymentRequest`
2. Policy Engine evaluates against settings, caps, vendor lists, velocity
3. If approval needed: notify via multi-channel + create approval record (reuses Phase 3.5 `ops.approval` infrastructure)
4. Wait for user decision OR apply auto-approve rules
5. Execute via Stripe connector only after approval clears
6. Log to Graphiti (with correct scoping) + `core.audit_log` + `TransactionLog`

### Testing requirements (non-negotiable)

**Overspending protection:**
- Hard daily/weekly/monthly caps cannot be exceeded under any condition
- Per-agent limits enforced independently
- Global kill switch instantly stops all spending across the org

**Edge cases:**
- Agent attempts payment when feature is globally disabled
- Multiple rapid payment requests (velocity protection)
- Payment fails after approval (retry logic + user notification path)
- User revokes approval at the last moment (race condition handling)
- High-risk transaction (large amount, unknown vendor) → confirmation gate

**Multi-user scenarios:**
- Department budget enforcement
- Role-based approval workflows ("Manager must approve >$500")
- Personal vs company-wide spending visibility per role

**Security:**
- Token / card leakage prevention
- Proper scoping in multi-user mode (RLS + Policy Engine in agreement)
- Audit log integrity (no gaps, no edits)

**Integration:**
- End-to-end with LangGraph Finance Agent
- Skills system integration (payment-capable skills route through the engine)
- Cadence integration (weekly spending summary routine)
- Graphiti logging accuracy and scope correctness

### Mode-awareness

- **Single-user:** all settings live on the personal org. Owner approves their own high-amount transactions. Personal kill switch.
- **Multi-user:** settings tier into account-level (caps + kill switch + global toggle), department-level (budgets + category rules), and per-agent (individual limits). Role-based approvals — Owner / Department Lead / Team Member each see + decide what their role permits.

> Constraint: this phase is purely backend work. No UI design — Paperclip's API + the future React console handle surface. Every new feature must respect the existing scope model and the Phase 3.5 RLS architecture.
