/**
 * On startup, ensure the demo org has one active agent of each kind we ship.
 * Idempotent — safe to call on every boot.
 */

import { audit } from "./audit.js";
import { query, withOrgScope } from "./db.js";
import { resolveCallerScope } from "./scope.js";

/**
 * Apply additive schema migrations at every boot so existing dev volumes
 * don't need a reset to pick up new tables/columns. Production-grade
 * migrations land in Phase 6 alongside the auth UI.
 */
const ADDITIVE_MIGRATIONS = [
  // ops.goal kind enum + first-class columns (was: jsonb metadata sprawl)
  `DO $$ BEGIN
     CREATE TYPE ops.goal_kind AS ENUM ('ephemeral', 'standing', 'routine', 'decision');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `ALTER TABLE ops.goal
     ADD COLUMN IF NOT EXISTS kind          ops.goal_kind NOT NULL DEFAULT 'ephemeral',
     ADD COLUMN IF NOT EXISTS cron_expr     text,
     ADD COLUMN IF NOT EXISTS due_at        timestamptz,
     ADD COLUMN IF NOT EXISTS progress      numeric(5,2),
     ADD COLUMN IF NOT EXISTS target_value  text,
     ADD COLUMN IF NOT EXISTS actual_value  text,
     ADD COLUMN IF NOT EXISTS delta_label   text,
     ADD COLUMN IF NOT EXISTS track_state   text;`,
  `CREATE INDEX IF NOT EXISTS goal_kind_idx ON ops.goal (org_id, kind, status);`,
  `CREATE INDEX IF NOT EXISTS goal_due_idx  ON ops.goal (org_id, due_at) WHERE due_at IS NOT NULL;`,

  // ops.key_result
  `CREATE TABLE IF NOT EXISTS ops.key_result (
     id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     goal_id        uuid NOT NULL REFERENCES ops.goal(id) ON DELETE CASCADE,
     label          text NOT NULL,
     target_value   text,
     current_value  text,
     unit           text,
     weight         numeric(6,3) NOT NULL DEFAULT 1.0,
     due_at         timestamptz,
     created_at     timestamptz NOT NULL DEFAULT now(),
     updated_at     timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS key_result_goal_idx ON ops.key_result (goal_id);`,

  // ops.goal_contributor
  `CREATE TABLE IF NOT EXISTS ops.goal_contributor (
     goal_id      uuid NOT NULL REFERENCES ops.goal(id) ON DELETE CASCADE,
     agent_id     uuid REFERENCES ops.agent(id) ON DELETE CASCADE,
     user_id      uuid REFERENCES core.user_account(id) ON DELETE CASCADE,
     added_at     timestamptz NOT NULL DEFAULT now(),
     CHECK ( (agent_id IS NOT NULL)::int + (user_id IS NOT NULL)::int = 1 )
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS goal_contributor_agent_uniq
     ON ops.goal_contributor (goal_id, agent_id) WHERE agent_id IS NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS goal_contributor_user_uniq
     ON ops.goal_contributor (goal_id, user_id)  WHERE user_id  IS NOT NULL;`,

  // ops.briefing
  `DO $$ BEGIN
     CREATE TYPE ops.briefing_kind AS ENUM ('daily', 'weekly', 'on_demand');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `CREATE TABLE IF NOT EXISTS ops.briefing (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id        uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
     kind          ops.briefing_kind NOT NULL,
     generated_at  timestamptz NOT NULL DEFAULT now(),
     period_start  timestamptz,
     period_end    timestamptz,
     summary_md    text NOT NULL,
     sources       jsonb NOT NULL DEFAULT '{}'::jsonb,
     audio_url     text
   );`,
  `CREATE INDEX IF NOT EXISTS briefing_org_kind_idx
     ON ops.briefing (org_id, kind, generated_at DESC);`,

  // Per-user briefings — when the onboarding interview captured a personal
  // briefing hour, the scheduler fires a user-scoped briefing alongside
  // the org-level one. NULL user_id = the org-level briefing.
  `ALTER TABLE ops.briefing
     ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES core.user_account(id) ON DELETE SET NULL;`,
  `CREATE INDEX IF NOT EXISTS briefing_user_kind_idx
     ON ops.briefing (user_id, kind, generated_at DESC) WHERE user_id IS NOT NULL;`,

  // ops.capture
  `DO $$ BEGIN
     CREATE TYPE ops.capture_source AS ENUM ('text', 'email', 'voice', 'image', 'webhook');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `CREATE TABLE IF NOT EXISTS ops.capture (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id          uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
     actor_id        uuid REFERENCES core.user_account(id) ON DELETE SET NULL,
     source          ops.capture_source NOT NULL,
     raw_content     text NOT NULL,
     parsed_intent   jsonb,
     resolved_to_id  uuid,
     resolved_kind   text,
     created_at      timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS capture_org_idx ON ops.capture (org_id, created_at DESC);`,

  // ops.run gets an acknowledged_at column so the user can dismiss inbox
  // items (drafts / routine outputs) without changing the run's status.
  `ALTER TABLE ops.run
     ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;`,
  `CREATE INDEX IF NOT EXISTS run_unacknowledged_idx
      ON ops.run (goal_id, finished_at DESC) WHERE acknowledged_at IS NULL;`,

  // -- Row-Level Security (Phase 3.5) ------------------------------------
  // Belt-and-suspenders alongside the in-code resolveCallerScope() filters.
  // Policies match `org_id` against the session GUC `app.org_id` when set;
  // when unset (existing routes that don't opt in yet), they fall through
  // to permissive — in-code filters remain authoritative. Routes opt in by
  // running their queries inside `withOrgScope(orgId, fn)` from db.ts.
  //
  // Eventually unset = NONE (block), once every route has opted in. That
  // flip is a one-line change to the policy expression.
  `ALTER TABLE ops.goal             ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.goal             FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.run              ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.run              FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.agent            ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.agent            FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.key_result       ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.key_result       FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.goal_contributor ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.goal_contributor FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.briefing         ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.briefing         FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.capture          ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.capture          FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE brain.memory         ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE brain.memory         FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE core.audit_log       ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE core.audit_log       FORCE  ROW LEVEL SECURITY;`,

  `DROP POLICY IF EXISTS app_scope_org ON ops.goal;`,
  `CREATE POLICY app_scope_org ON ops.goal
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,

  `DROP POLICY IF EXISTS app_scope_org ON ops.agent;`,
  `CREATE POLICY app_scope_org ON ops.agent
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,

  // ops.run is scoped via its parent goal (no direct org_id column).
  `DROP POLICY IF EXISTS app_scope_org ON ops.run;`,
  `CREATE POLICY app_scope_org ON ops.run
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR EXISTS (
                   SELECT 1 FROM ops.goal g
                    WHERE g.id = ops.run.goal_id
                      AND g.org_id::text = current_setting('app.org_id', true)
                 ))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR EXISTS (
                   SELECT 1 FROM ops.goal g
                    WHERE g.id = ops.run.goal_id
                      AND g.org_id::text = current_setting('app.org_id', true)
                 ));`,

  // ops.key_result + ops.goal_contributor — same parent-goal indirection.
  `DROP POLICY IF EXISTS app_scope_org ON ops.key_result;`,
  `CREATE POLICY app_scope_org ON ops.key_result
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR EXISTS (
                   SELECT 1 FROM ops.goal g
                    WHERE g.id = ops.key_result.goal_id
                      AND g.org_id::text = current_setting('app.org_id', true)
                 ))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR EXISTS (
                   SELECT 1 FROM ops.goal g
                    WHERE g.id = ops.key_result.goal_id
                      AND g.org_id::text = current_setting('app.org_id', true)
                 ));`,

  `DROP POLICY IF EXISTS app_scope_org ON ops.goal_contributor;`,
  `CREATE POLICY app_scope_org ON ops.goal_contributor
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR EXISTS (
                   SELECT 1 FROM ops.goal g
                    WHERE g.id = ops.goal_contributor.goal_id
                      AND g.org_id::text = current_setting('app.org_id', true)
                 ))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR EXISTS (
                   SELECT 1 FROM ops.goal g
                    WHERE g.id = ops.goal_contributor.goal_id
                      AND g.org_id::text = current_setting('app.org_id', true)
                 ));`,

  `DROP POLICY IF EXISTS app_scope_org ON ops.briefing;`,
  `CREATE POLICY app_scope_org ON ops.briefing
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,

  `DROP POLICY IF EXISTS app_scope_org ON ops.capture;`,
  `CREATE POLICY app_scope_org ON ops.capture
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,

  `DROP POLICY IF EXISTS app_scope_org ON brain.memory;`,
  `CREATE POLICY app_scope_org ON brain.memory
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,

  // audit_log allows NULL org_id (rare — surfaces after org delete).
  `DROP POLICY IF EXISTS app_scope_org ON core.audit_log;`,
  `CREATE POLICY app_scope_org ON core.audit_log
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id IS NULL
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id IS NULL
                 OR org_id::text = current_setting('app.org_id', true));`,

  // =========================================================================
  // Four Cs — extension tables
  // -------------------------------------------------------------------------
  // Capabilities: ops.skill (the manifest registry — YAML on disk is the
  //               source of truth, Postgres holds the discovered metadata
  //               for fast queries + scope filters).
  // Cadence:      ops.routine_trigger (event/api-triggered routines on top
  //               of the existing kind=routine + cron_expr scheduler).
  // Context:      ops.knowledge_doc + ops.knowledge_link (markdown wiki
  //               with backlinks, scoped personal / company / shared).
  // Onboarding:   ops.onboarding_profile (interview answers + derived
  //               config, mode-aware).
  // Self-improve: ops.audit_report (Audit + Level-Up skill outputs).
  // =========================================================================

  `DO $$ BEGIN
     CREATE TYPE ops.skill_scope AS ENUM ('personal', 'company', 'shared');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  `CREATE TABLE IF NOT EXISTS ops.skill (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id          uuid REFERENCES core.organization(id) ON DELETE CASCADE,
     slug            text NOT NULL,
     version         integer NOT NULL DEFAULT 1,
     scope           ops.skill_scope NOT NULL DEFAULT 'shared',
     mode_aware      boolean NOT NULL DEFAULT false,
     agent_kind      text NOT NULL,
     title           text NOT NULL,
     description     text,
     manifest_path   text NOT NULL,
     params_schema   jsonb NOT NULL DEFAULT '{}'::jsonb,
     side_effects    text NOT NULL DEFAULT 'read',
     required_role   core.role_kind,
     approval_under  numeric,
     enabled         boolean NOT NULL DEFAULT true,
     created_at      timestamptz NOT NULL DEFAULT now(),
     updated_at      timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS skill_scope_slug_uniq
      ON ops.skill (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug, version);`,
  `CREATE INDEX IF NOT EXISTS skill_org_scope_idx ON ops.skill (org_id, scope, enabled);`,

  `DO $$ BEGIN
     CREATE TYPE ops.routine_trigger_kind AS ENUM ('schedule', 'event', 'api');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  `CREATE TABLE IF NOT EXISTS ops.routine_trigger (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     goal_id       uuid NOT NULL REFERENCES ops.goal(id) ON DELETE CASCADE,
     trigger_kind  ops.routine_trigger_kind NOT NULL,
     -- schedule    : { "cron_expr": "0 9 * * 1" }    (mirrors goal.cron_expr; null for non-schedule)
     -- event       : { "action": "decision.approve", "match": { "metadata.kind": "..." } }
     -- api         : { "endpoint_token": "..." }     (the trigger fires when this token is hit)
     trigger_spec  jsonb NOT NULL DEFAULT '{}'::jsonb,
     enabled       boolean NOT NULL DEFAULT true,
     last_fired_at timestamptz,
     created_at    timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS routine_trigger_goal_idx ON ops.routine_trigger (goal_id);`,
  `CREATE INDEX IF NOT EXISTS routine_trigger_kind_idx ON ops.routine_trigger (trigger_kind, enabled);`,

  `DO $$ BEGIN
     CREATE TYPE ops.onboarding_mode AS ENUM ('single_user', 'multi_user');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  `CREATE TABLE IF NOT EXISTS ops.onboarding_profile (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id        uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
     user_id       uuid REFERENCES core.user_account(id) ON DELETE CASCADE,
     mode          ops.onboarding_mode NOT NULL,
     -- Q&A in document form: [{ "id": "Q1", "question": "...", "answer": "...", "asked_at": "..." }]
     answers       jsonb NOT NULL DEFAULT '[]'::jsonb,
     -- Derived from answers: brand voice, default agents, suggested routines, skills.
     derived       jsonb NOT NULL DEFAULT '{}'::jsonb,
     completed_at  timestamptz,
     created_at    timestamptz NOT NULL DEFAULT now(),
     updated_at    timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS onboarding_profile_org_user_uniq
      ON ops.onboarding_profile (org_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid));`,

  `DO $$ BEGIN
     CREATE TYPE ops.audit_report_kind AS ENUM ('audit', 'level_up');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  `CREATE TABLE IF NOT EXISTS ops.audit_report (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id          uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
     user_id         uuid REFERENCES core.user_account(id) ON DELETE SET NULL,
     kind            ops.audit_report_kind NOT NULL,
     period_start    timestamptz NOT NULL,
     period_end      timestamptz NOT NULL,
     summary_md      text NOT NULL,
     findings        jsonb NOT NULL DEFAULT '[]'::jsonb,
     suggestions     jsonb NOT NULL DEFAULT '[]'::jsonb,
     applied         boolean NOT NULL DEFAULT false,
     created_at      timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS audit_report_org_kind_idx
      ON ops.audit_report (org_id, kind, created_at DESC);`,

  `DO $$ BEGIN
     CREATE TYPE ops.knowledge_scope AS ENUM ('personal', 'company', 'shared');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  `CREATE TABLE IF NOT EXISTS ops.knowledge_doc (
     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id       uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
     user_id      uuid REFERENCES core.user_account(id) ON DELETE SET NULL,
     slug         text NOT NULL,
     title        text NOT NULL,
     scope        ops.knowledge_scope NOT NULL DEFAULT 'company',
     hot          boolean NOT NULL DEFAULT false,
     content_md   text NOT NULL,
     tags         text[] NOT NULL DEFAULT ARRAY[]::text[],
     -- Pointer back to gbrain so semantic recall finds the doc too.
     memory_id    uuid,
     created_at   timestamptz NOT NULL DEFAULT now(),
     updated_at   timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS knowledge_doc_slug_uniq
      ON ops.knowledge_doc (org_id, scope, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);`,
  `CREATE INDEX IF NOT EXISTS knowledge_doc_hot_idx
      ON ops.knowledge_doc (org_id, scope, hot) WHERE hot = true;`,
  `CREATE INDEX IF NOT EXISTS knowledge_doc_tags_idx ON ops.knowledge_doc USING GIN (tags);`,

  `CREATE TABLE IF NOT EXISTS ops.knowledge_link (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     from_doc_id uuid NOT NULL REFERENCES ops.knowledge_doc(id) ON DELETE CASCADE,
     to_doc_id   uuid NOT NULL REFERENCES ops.knowledge_doc(id) ON DELETE CASCADE,
     anchor      text,
     created_at  timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS knowledge_link_uniq
      ON ops.knowledge_link (from_doc_id, to_doc_id, COALESCE(anchor, ''));`,
  `CREATE INDEX IF NOT EXISTS knowledge_link_to_idx ON ops.knowledge_link (to_doc_id);`,

  // RLS for the new tables — same permissive-when-unset policy as existing.
  `ALTER TABLE ops.skill              ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.skill              FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.routine_trigger    ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.routine_trigger    FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.onboarding_profile ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.onboarding_profile FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.audit_report       ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.audit_report       FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.knowledge_doc      ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.knowledge_doc      FORCE  ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.knowledge_link     ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.knowledge_link     FORCE  ROW LEVEL SECURITY;`,

  // Skills with scope='shared' have NULL org_id (global registry); allow them through.
  `DROP POLICY IF EXISTS app_scope_org ON ops.skill;`,
  `CREATE POLICY app_scope_org ON ops.skill
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id IS NULL
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id IS NULL
                 OR org_id::text = current_setting('app.org_id', true));`,

  `DROP POLICY IF EXISTS app_scope_org ON ops.routine_trigger;`,
  `CREATE POLICY app_scope_org ON ops.routine_trigger
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR EXISTS (
                   SELECT 1 FROM ops.goal g
                    WHERE g.id = ops.routine_trigger.goal_id
                      AND g.org_id::text = current_setting('app.org_id', true)
                 ))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR EXISTS (
                   SELECT 1 FROM ops.goal g
                    WHERE g.id = ops.routine_trigger.goal_id
                      AND g.org_id::text = current_setting('app.org_id', true)
                 ));`,

  `DROP POLICY IF EXISTS app_scope_org ON ops.onboarding_profile;`,
  `CREATE POLICY app_scope_org ON ops.onboarding_profile
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,

  `DROP POLICY IF EXISTS app_scope_org ON ops.audit_report;`,
  `CREATE POLICY app_scope_org ON ops.audit_report
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,

  `DROP POLICY IF EXISTS app_scope_org ON ops.knowledge_doc;`,
  `CREATE POLICY app_scope_org ON ops.knowledge_doc
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR scope = 'shared'
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,

  `DROP POLICY IF EXISTS app_scope_org ON ops.knowledge_link;`,
  `CREATE POLICY app_scope_org ON ops.knowledge_link
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR EXISTS (
                   SELECT 1 FROM ops.knowledge_doc d
                    WHERE d.id = ops.knowledge_link.from_doc_id
                      AND (d.scope = 'shared'
                           OR d.org_id::text = current_setting('app.org_id', true))
                 ))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR EXISTS (
                   SELECT 1 FROM ops.knowledge_doc d
                    WHERE d.id = ops.knowledge_link.from_doc_id
                      AND d.org_id::text = current_setting('app.org_id', true)
                 ));`,

  // =========================================================================
  // Approval queue — Phase 5 foundation.
  //
  // Agents that want to take a side-effecting action (send an email, charge
  // a card, hire someone) propose an approval row and wait. The user
  // resolves via /api/approvals/:id/approve|decline. Resolution wakes the
  // paused run (eventually — see docs/INTEGRATION_PLAN.md §8 for agent
  // adoption notes; v0 stores the proposal cleanly so the UX exists even
  // before agents pause-and-await).
  // =========================================================================

  `DO $$ BEGIN
     CREATE TYPE ops.approval_resolution AS ENUM ('approved', 'declined', 'expired');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  `DO $$ BEGIN
     CREATE TYPE ops.approval_urgency AS ENUM ('low', 'normal', 'urgent');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  `CREATE TABLE IF NOT EXISTS ops.approval (
     id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id                uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
     goal_id               uuid REFERENCES ops.goal(id) ON DELETE SET NULL,
     run_id                uuid REFERENCES ops.run(id)  ON DELETE SET NULL,
     requesting_agent_id   uuid REFERENCES ops.agent(id) ON DELETE SET NULL,
     action_kind           text NOT NULL,
     proposal              jsonb NOT NULL DEFAULT '{}'::jsonb,
     reason                text,
     urgency               ops.approval_urgency NOT NULL DEFAULT 'normal',
     expires_at            timestamptz,
     resolution            ops.approval_resolution,
     resolved_by_user_id   uuid REFERENCES core.user_account(id) ON DELETE SET NULL,
     resolved_at           timestamptz,
     resolution_note       text,
     created_at            timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS approval_org_pending_idx
      ON ops.approval (org_id, urgency, created_at DESC)
      WHERE resolution IS NULL;`,
  `CREATE INDEX IF NOT EXISTS approval_run_idx ON ops.approval (run_id);`,

  `ALTER TABLE ops.approval ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.approval FORCE  ROW LEVEL SECURITY;`,
  `DROP POLICY IF EXISTS app_scope_org ON ops.approval;`,
  `CREATE POLICY app_scope_org ON ops.approval
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,

  // The worker writes audit rows with actor_role='agent', but the SQL
  // `core.role_kind` enum was originally created without it. Patch it in
  // additively so existing dev volumes don't need a wipe.
  `ALTER TYPE core.role_kind ADD VALUE IF NOT EXISTS 'agent';`,

  // -- Phase 9: outbound payments safety primitives -----------------------
  // Data models for the safety layer that gates every agent payment.
  // Stripe connector + Finance Agent live in a future cloud sprint;
  // this lays the locally-testable foundation.
  `DO $$ BEGIN
     CREATE TYPE ops.payment_status AS ENUM (
       'pending','approved','executing','succeeded','failed','declined','expired','killed'
     );
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
     CREATE TYPE ops.spending_period AS ENUM ('per_request','daily','weekly','monthly');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  // Singleton-per-org. enabled=false (master off) is the default — no
  // payment can be requested until the operator flips it. kill_switch=true
  // halts every payment regardless of other settings; only the operator
  // can clear it.
  `CREATE TABLE IF NOT EXISTS ops.payment_settings (
     org_id              uuid PRIMARY KEY REFERENCES core.organization(id) ON DELETE CASCADE,
     enabled             boolean NOT NULL DEFAULT false,
     kill_switch         boolean NOT NULL DEFAULT false,
     default_limit_cents bigint  NOT NULL DEFAULT 0,
     default_period      ops.spending_period NOT NULL DEFAULT 'per_request',
     approval_threshold  bigint  NOT NULL DEFAULT 0,
     notify_email        text,
     updated_at          timestamptz NOT NULL DEFAULT now()
   );`,
  `ALTER TABLE ops.payment_settings ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.payment_settings FORCE  ROW LEVEL SECURITY;`,
  `DROP POLICY IF EXISTS app_scope_org ON ops.payment_settings;`,
  `CREATE POLICY app_scope_org ON ops.payment_settings
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,
  `DROP POLICY IF EXISTS app_system_scope ON ops.payment_settings;`,
  `CREATE POLICY app_system_scope ON ops.payment_settings
     AS PERMISSIVE FOR ALL
     USING      (current_setting('app.system_scope', true) = 'true')
     WITH CHECK (current_setting('app.system_scope', true) = 'true');`,

  // Per-agent caps. Override the org default for a single agent_id.
  // category lets an operator say "Hermes can spend $X/month, but only
  // on category=research".
  `CREATE TABLE IF NOT EXISTS ops.agent_spending_limit (
     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id       uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
     agent_id     uuid NOT NULL REFERENCES ops.agent(id) ON DELETE CASCADE,
     limit_cents  bigint NOT NULL CHECK (limit_cents >= 0),
     period       ops.spending_period NOT NULL DEFAULT 'monthly',
     category     text,
     created_at   timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS asl_agent_idx ON ops.agent_spending_limit (agent_id);`,
  `ALTER TABLE ops.agent_spending_limit ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.agent_spending_limit FORCE  ROW LEVEL SECURITY;`,
  `DROP POLICY IF EXISTS app_scope_org ON ops.agent_spending_limit;`,
  `CREATE POLICY app_scope_org ON ops.agent_spending_limit
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,
  `DROP POLICY IF EXISTS app_system_scope ON ops.agent_spending_limit;`,
  `CREATE POLICY app_system_scope ON ops.agent_spending_limit
     AS PERMISSIVE FOR ALL
     USING      (current_setting('app.system_scope', true) = 'true')
     WITH CHECK (current_setting('app.system_scope', true) = 'true');`,

  // Every payment the system considers — pending, approved, declined,
  // killed, executed. external_ref holds the connector's id (Stripe
  // charge id, etc.) once executed; null until then.
  `CREATE TABLE IF NOT EXISTS ops.payment_request (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id          uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
     agent_id        uuid REFERENCES ops.agent(id) ON DELETE SET NULL,
     goal_id         uuid REFERENCES ops.goal(id) ON DELETE SET NULL,
     run_id          uuid REFERENCES ops.run(id)  ON DELETE SET NULL,
     amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
     currency        text   NOT NULL DEFAULT 'USD',
     vendor          text   NOT NULL,
     category        text,
     description     text   NOT NULL,
     status          ops.payment_status NOT NULL DEFAULT 'pending',
     approval_id     uuid REFERENCES ops.approval(id) ON DELETE SET NULL,
     decided_reason  text,
     external_ref    text,
     created_at      timestamptz NOT NULL DEFAULT now(),
     decided_at      timestamptz,
     executed_at     timestamptz
   );`,
  `CREATE INDEX IF NOT EXISTS pr_org_status_idx ON ops.payment_request (org_id, status, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS pr_agent_idx      ON ops.payment_request (agent_id, created_at DESC);`,
  `ALTER TABLE ops.payment_request ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.payment_request FORCE  ROW LEVEL SECURITY;`,
  `DROP POLICY IF EXISTS app_scope_org ON ops.payment_request;`,
  `CREATE POLICY app_scope_org ON ops.payment_request
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,
  `DROP POLICY IF EXISTS app_system_scope ON ops.payment_request;`,
  `CREATE POLICY app_system_scope ON ops.payment_request
     AS PERMISSIVE FOR ALL
     USING      (current_setting('app.system_scope', true) = 'true')
     WITH CHECK (current_setting('app.system_scope', true) = 'true');`,

  // Audit trail of every kill-switch flip — both directions. Lets us
  // reconstruct "who turned it on at 03:14, who cleared it at 09:30".
  `CREATE TABLE IF NOT EXISTS ops.kill_switch_event (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id        uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
     active        boolean NOT NULL,
     triggered_by  uuid REFERENCES core.user_account(id) ON DELETE SET NULL,
     reason        text,
     created_at    timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS kse_org_idx ON ops.kill_switch_event (org_id, created_at DESC);`,
  `ALTER TABLE ops.kill_switch_event ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.kill_switch_event FORCE  ROW LEVEL SECURITY;`,
  `DROP POLICY IF EXISTS app_scope_org ON ops.kill_switch_event;`,
  `CREATE POLICY app_scope_org ON ops.kill_switch_event
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,
  `DROP POLICY IF EXISTS app_system_scope ON ops.kill_switch_event;`,
  `CREATE POLICY app_system_scope ON ops.kill_switch_event
     AS PERMISSIVE FOR ALL
     USING      (current_setting('app.system_scope', true) = 'true')
     WITH CHECK (current_setting('app.system_scope', true) = 'true');`,

  // -- ops.tool — MCP tool registry ----------------------------------------
  // Mirrors ops.skill's structure but for MCP tools: a discoverable tool
  // (name, transport, target, input_schema) that an agent can call. YAML
  // manifests in packages/tools/manifests/{shared,company,personal}/ are
  // the source of truth; the loader upserts shared manifests on every
  // boot. Per-org tools (transport=stdio with org-specific binaries)
  // live behind onboarding.
  `DO $$ BEGIN
     CREATE TYPE ops.tool_transport AS ENUM ('stdio', 'http', 'sse', 'websocket');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `CREATE TABLE IF NOT EXISTS ops.tool (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id          uuid REFERENCES core.organization(id) ON DELETE CASCADE,
     slug            text NOT NULL,
     version         integer NOT NULL DEFAULT 1,
     scope           ops.skill_scope NOT NULL DEFAULT 'shared',
     name            text NOT NULL,
     description     text,
     transport       ops.tool_transport NOT NULL,
     target          text NOT NULL,
     env_keys        jsonb NOT NULL DEFAULT '[]'::jsonb,
     input_schema    jsonb NOT NULL DEFAULT '{}'::jsonb,
     manifest_path   text NOT NULL,
     enabled         boolean NOT NULL DEFAULT true,
     created_at      timestamptz NOT NULL DEFAULT now(),
     updated_at      timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tool_uniq_idx
      ON ops.tool (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug, version);`,
  `ALTER TABLE ops.tool ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.tool FORCE  ROW LEVEL SECURITY;`,
  `DROP POLICY IF EXISTS app_scope_org ON ops.tool;`,
  `CREATE POLICY app_scope_org ON ops.tool
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id IS NULL
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id IS NULL
                 OR org_id::text = current_setting('app.org_id', true));`,
  `DROP POLICY IF EXISTS app_system_scope ON ops.tool;`,
  `CREATE POLICY app_system_scope ON ops.tool
     AS PERMISSIVE FOR ALL
     USING      (current_setting('app.system_scope', true) = 'true')
     WITH CHECK (current_setting('app.system_scope', true) = 'true');`,

  // -- ops.policy — (role, agent_kind, skill_slug, action_kind) → effect --
  // The policy engine. Every skill invocation passes through evaluatePolicy
  // before queueing. Multiple matching rows: lowest priority wins, ties
  // broken by most-specific (fewest wildcards). No match → effect='allow'
  // by default (callers add an explicit wildcard 'deny' for deny-by-default
  // postures).
  `DO $$ BEGIN
     CREATE TYPE ops.policy_effect AS ENUM ('allow', 'approve', 'deny');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `CREATE TABLE IF NOT EXISTS ops.policy (
     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id       uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
     role         core.role_kind,
     agent_kind   text,
     skill_slug   text,
     action_kind  text,
     effect       ops.policy_effect NOT NULL,
     priority     integer NOT NULL DEFAULT 100,
     reason       text,
     created_at   timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS policy_lookup_idx ON ops.policy (org_id, priority);`,
  `ALTER TABLE ops.policy ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.policy FORCE  ROW LEVEL SECURITY;`,
  `DROP POLICY IF EXISTS app_scope_org ON ops.policy;`,
  `CREATE POLICY app_scope_org ON ops.policy
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id::text = current_setting('app.org_id', true));`,
  `DROP POLICY IF EXISTS app_system_scope ON ops.policy;`,
  `CREATE POLICY app_system_scope ON ops.policy
     AS PERMISSIVE FOR ALL
     USING      (current_setting('app.system_scope', true) = 'true')
     WITH CHECK (current_setting('app.system_scope', true) = 'true');`,

  // -- Phase B: privileged "system scope" sibling policy ------------------
  // Cross-org tasks (worker run-claim, scheduler routine scan, briefing
  // sweep, health counts) bind `app.system_scope = 'true'` via
  // `withSystemScope()` in db.ts. PERMISSIVE policies are OR'd, so
  // app_system_scope unblocks the row whenever the GUC is set. Adding it
  // here is non-breaking: callers that don't set it continue to flow
  // through app_scope_org's permissive-on-unset branch.
  ...[
    "ops.goal",
    "ops.agent",
    "ops.run",
    "ops.key_result",
    "ops.goal_contributor",
    "ops.briefing",
    "ops.capture",
    "brain.memory",
    "core.audit_log",
    "ops.skill",
    "ops.routine_trigger",
    "ops.onboarding_profile",
    "ops.audit_report",
    "ops.knowledge_doc",
    "ops.knowledge_link",
    "ops.approval",
  ].flatMap((tbl) => [
    `DROP POLICY IF EXISTS app_system_scope ON ${tbl};`,
    `CREATE POLICY app_system_scope ON ${tbl}
       AS PERMISSIVE FOR ALL
       USING      (current_setting('app.system_scope', true) = 'true')
       WITH CHECK (current_setting('app.system_scope', true) = 'true');`,
  ]),

  // -- ops.llm_call_log — Phase 2.1.c -------------------------------------
  // One row per Portkey-routed LLM call. The gateway writes these on every
  // response (success or failure). Mirrors what the Portkey dashboard
  // already shows but keeps an in-system view so `bc tail`, `bc llm`, and
  // the future console can render LLM cost/latency without leaving
  // paperclip. Also our backup if Portkey is unreachable for queries.
  `CREATE TABLE IF NOT EXISTS ops.llm_call_log (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id          uuid REFERENCES core.organization(id) ON DELETE SET NULL,
     run_id          uuid REFERENCES ops.run(id) ON DELETE SET NULL,
     provider        text NOT NULL,
     model           text NOT NULL,
     tokens_in       integer NOT NULL DEFAULT 0,
     tokens_out      integer NOT NULL DEFAULT 0,
     latency_ms      integer NOT NULL DEFAULT 0,
     status          text NOT NULL,
     error           text,
     portkey_trace_id text,
     created_at      timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS llm_call_log_org_idx
      ON ops.llm_call_log (org_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS llm_call_log_run_idx
      ON ops.llm_call_log (run_id, created_at DESC);`,
  `ALTER TABLE ops.llm_call_log ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE ops.llm_call_log FORCE  ROW LEVEL SECURITY;`,
  `DROP POLICY IF EXISTS app_scope_org ON ops.llm_call_log;`,
  `CREATE POLICY app_scope_org ON ops.llm_call_log
     USING      (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id IS NULL
                 OR org_id::text = current_setting('app.org_id', true))
     WITH CHECK (current_setting('app.org_id', true) IS NULL
                 OR current_setting('app.org_id', true) = ''
                 OR org_id IS NULL
                 OR org_id::text = current_setting('app.org_id', true));`,
  `DROP POLICY IF EXISTS app_system_scope ON ops.llm_call_log;`,
  `CREATE POLICY app_system_scope ON ops.llm_call_log
     AS PERMISSIVE FOR ALL
     USING      (current_setting('app.system_scope', true) = 'true')
     WITH CHECK (current_setting('app.system_scope', true) = 'true');`,
];

export async function applyAdditiveMigrations(
  log: { info: (msg: string) => void },
): Promise<void> {
  for (const sql of ADDITIVE_MIGRATIONS) {
    await query(sql);
  }
  log.info(`bootstrap: additive migrations applied (${ADDITIVE_MIGRATIONS.length} statements)`);
}

const DEFAULT_AGENTS: Array<{ kind: string; name: string; description: string }> = [
  {
    kind: "hermes",
    name: "Hermes — General Reasoning",
    description: "General-purpose workforce agent. Reads memories, drafts, plans, decides.",
  },
  {
    kind: "openclaw",
    name: "OpenClaw — Web Actions",
    description: "Tool-action agent. Fetches URLs and stores them as documents.",
  },
  {
    kind: "langgraph",
    name: "LangGraph — Multi-Agent Dispatcher",
    description: "Orchestrator that classifies subtasks and routes to Hermes or OpenClaw.",
  },
];

export async function ensureDefaultAgents(
  log: { info: (msg: string) => void },
): Promise<void> {
  const scope = await resolveCallerScope();

  for (const def of DEFAULT_AGENTS) {
    const created = await withOrgScope(scope.org_id, async (client) => {
      const { rows: existing } = await client.query<{ id: string }>(
        "SELECT id FROM ops.agent WHERE org_id = $1 AND kind = $2 LIMIT 1",
        [scope.org_id, def.kind],
      );
      if (existing.length > 0) return undefined;

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO ops.agent (org_id, kind, name, config, is_active)
         VALUES ($1, $2, $3, $4::jsonb, true)
         RETURNING id`,
        [scope.org_id, def.kind, def.name, JSON.stringify({ description: def.description })],
      );
      const agentId = rows[0]!.id;
      await audit(
        {
          scope,
          action: "agent.hire",
          target_type: "agent",
          target_id: agentId,
          metadata: { kind: def.kind, name: def.name, source: "bootstrap" },
        },
        client,
      );
      return agentId;
    });
    if (created) {
      log.info(`bootstrap: hired default agent ${def.kind} (${created})`);
    }
  }
}
