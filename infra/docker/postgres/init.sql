-- =============================================================================
-- Blank Collar — Agentic OS · Postgres bootstrap schema (Phase 0)
-- -----------------------------------------------------------------------------
-- This file runs ONCE, the first time the postgres container starts with an
-- empty data volume. To re-run it, wipe the volume:
--     docker compose down -v
--
-- Goal: lay down the minimum tables needed so the orchestrator (Phase 2) and
-- the memory layer (Phase 1) can plug in without schema migrations on day 1.
-- =============================================================================

-- Required extensions ---------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive emails

-- Logical schemas -------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS core;     -- orgs, users, roles, audit
CREATE SCHEMA IF NOT EXISTS ops;      -- goals, runs, agents
CREATE SCHEMA IF NOT EXISTS brain;    -- memory metadata (vectors live in Qdrant)

-- =============================================================================
-- core: organizations, departments, users, roles
-- =============================================================================
CREATE TABLE IF NOT EXISTS core.organization (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         text UNIQUE NOT NULL,
    name         text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.department (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
    slug         text NOT NULL,
    name         text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS core.user_account (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
    email        citext UNIQUE NOT NULL,
    display_name text,
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Role enum: keep lowercase, hyphenless, easy to compare in code paths
DO $$ BEGIN
    CREATE TYPE core.role_kind AS ENUM (
        'owner',
        'department_lead',
        'team_member',
        'auditor',
        'agent'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS core.role_assignment (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES core.user_account(id) ON DELETE CASCADE,
    department_id uuid REFERENCES core.department(id) ON DELETE CASCADE,
    role          core.role_kind NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    -- A user may be Owner globally (department_id NULL) OR scoped to a department.
    UNIQUE (user_id, department_id, role)
);

CREATE TABLE IF NOT EXISTS core.audit_log (
    id           bigserial PRIMARY KEY,
    org_id       uuid REFERENCES core.organization(id) ON DELETE SET NULL,
    actor_id     uuid REFERENCES core.user_account(id) ON DELETE SET NULL,
    actor_role   core.role_kind,
    action       text NOT NULL,
    target_type  text,
    target_id    text,
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_org_idx     ON core.audit_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx   ON core.audit_log (actor_id, created_at DESC);

-- =============================================================================
-- ops: goals, runs, agents
-- =============================================================================
DO $$ BEGIN
    CREATE TYPE ops.goal_status AS ENUM (
        'draft', 'active', 'paused', 'achieved', 'archived'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE ops.run_status AS ENUM (
        'queued', 'running', 'succeeded', 'failed', 'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ops.agent (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
    kind         text NOT NULL,                 -- 'hermes', 'openclaw', ...
    name         text NOT NULL,
    config       jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops.goal (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
    department_id uuid REFERENCES core.department(id) ON DELETE SET NULL,
    owner_id      uuid REFERENCES core.user_account(id) ON DELETE SET NULL,
    title         text NOT NULL,
    description   text,
    status        ops.goal_status NOT NULL DEFAULT 'draft',
    metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS goal_dept_status_idx ON ops.goal (department_id, status);

CREATE TABLE IF NOT EXISTS ops.run (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id       uuid NOT NULL REFERENCES ops.goal(id) ON DELETE CASCADE,
    agent_id      uuid REFERENCES ops.agent(id) ON DELETE SET NULL,
    status        ops.run_status NOT NULL DEFAULT 'queued',
    input         jsonb NOT NULL DEFAULT '{}'::jsonb,
    output        jsonb,
    error         text,
    started_at    timestamptz,
    finished_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_goal_idx   ON ops.run (goal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS run_status_idx ON ops.run (status, created_at);

-- =============================================================================
-- ops: goal kind + first-class fields (was: jsonb metadata)
-- The user-facing primitive is "things on your plate" — internally a goal can be:
--   ephemeral  — one-off task, runs once and archives
--   standing   — long-lived objective with key results
--   routine    — recurring on a cron schedule
--   decision   — single yes/no awaiting the user
-- =============================================================================
DO $$ BEGIN
    CREATE TYPE ops.goal_kind AS ENUM ('ephemeral', 'standing', 'routine', 'decision');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE ops.goal
    ADD COLUMN IF NOT EXISTS kind          ops.goal_kind NOT NULL DEFAULT 'ephemeral',
    ADD COLUMN IF NOT EXISTS cron_expr     text,
    ADD COLUMN IF NOT EXISTS due_at        timestamptz,
    ADD COLUMN IF NOT EXISTS progress      numeric(5,2),
    ADD COLUMN IF NOT EXISTS target_value  text,
    ADD COLUMN IF NOT EXISTS actual_value  text,
    ADD COLUMN IF NOT EXISTS delta_label   text,
    ADD COLUMN IF NOT EXISTS track_state   text;

CREATE INDEX IF NOT EXISTS goal_kind_idx     ON ops.goal (org_id, kind, status);
CREATE INDEX IF NOT EXISTS goal_due_idx      ON ops.goal (org_id, due_at) WHERE due_at IS NOT NULL;

-- Key results — only meaningful for kind='standing', but available everywhere.
CREATE TABLE IF NOT EXISTS ops.key_result (
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
);
CREATE INDEX IF NOT EXISTS key_result_goal_idx ON ops.key_result (goal_id);

-- Contributors — humans and agents that work on a goal together.
CREATE TABLE IF NOT EXISTS ops.goal_contributor (
    goal_id      uuid NOT NULL REFERENCES ops.goal(id) ON DELETE CASCADE,
    agent_id     uuid REFERENCES ops.agent(id) ON DELETE CASCADE,
    user_id      uuid REFERENCES core.user_account(id) ON DELETE CASCADE,
    added_at     timestamptz NOT NULL DEFAULT now(),
    -- Exactly one of agent_id / user_id is set per row.
    CHECK ( (agent_id IS NOT NULL)::int + (user_id IS NOT NULL)::int = 1 )
);
CREATE UNIQUE INDEX IF NOT EXISTS goal_contributor_agent_uniq
    ON ops.goal_contributor (goal_id, agent_id) WHERE agent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS goal_contributor_user_uniq
    ON ops.goal_contributor (goal_id, user_id)  WHERE user_id  IS NOT NULL;

-- =============================================================================
-- ops: briefing — generated editorial summary (daily / weekly / on_demand)
-- Not a button; a real resource. Hermes writes the copy in brand voice.
-- =============================================================================
DO $$ BEGIN
    CREATE TYPE ops.briefing_kind AS ENUM ('daily', 'weekly', 'on_demand');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ops.briefing (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
    kind          ops.briefing_kind NOT NULL,
    generated_at  timestamptz NOT NULL DEFAULT now(),
    period_start  timestamptz,
    period_end    timestamptz,
    summary_md    text NOT NULL,
    sources       jsonb NOT NULL DEFAULT '{}'::jsonb,
    audio_url     text
);
CREATE INDEX IF NOT EXISTS briefing_org_kind_idx
    ON ops.briefing (org_id, kind, generated_at DESC);

-- =============================================================================
-- ops: capture — every raw thing the user throws at the system before it
-- gets classified into the right downstream shape. Email forward, voice memo,
-- typed text, photo, webhook payload. The audit trail of "what did you tell
-- me, and what did I do with it."
-- =============================================================================
DO $$ BEGIN
    CREATE TYPE ops.capture_source AS ENUM ('text', 'email', 'voice', 'image', 'webhook');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ops.capture (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
    actor_id        uuid REFERENCES core.user_account(id) ON DELETE SET NULL,
    source          ops.capture_source NOT NULL,
    raw_content     text NOT NULL,
    parsed_intent   jsonb,
    resolved_to_id  uuid,
    resolved_kind   text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capture_org_idx ON ops.capture (org_id, created_at DESC);

-- =============================================================================
-- brain: memory metadata (vectors themselves live in Qdrant)
-- =============================================================================
DO $$ BEGIN
    CREATE TYPE brain.memory_kind AS ENUM ('fact', 'episode', 'document', 'conversation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS brain.memory (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES core.organization(id) ON DELETE CASCADE,
    department_id uuid REFERENCES core.department(id) ON DELETE SET NULL,
    goal_id       uuid REFERENCES ops.goal(id) ON DELETE SET NULL,
    kind          brain.memory_kind NOT NULL,
    title         text,
    content       text NOT NULL,
    -- Pointer into Qdrant: collection + point id
    vector_ref    jsonb,
    -- Visibility scope is enforced in app code AND mirrored here for fast filtering
    visible_to    core.role_kind[] NOT NULL DEFAULT ARRAY['owner','department_lead']::core.role_kind[],
    metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memory_dept_kind_idx ON brain.memory (department_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_goal_idx      ON brain.memory (goal_id, created_at DESC);

-- =============================================================================
-- Seed: a single demo org + departments so devs see something on first boot
-- =============================================================================
INSERT INTO core.organization (slug, name)
VALUES ('blankcollar-demo', 'Blank Collar — Demo Org')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO core.department (org_id, slug, name)
SELECT id, dept.slug, dept.name
FROM core.organization,
     (VALUES
        ('marketing',  'Marketing'),
        ('sales',      'Sales'),
        ('support',    'Support'),
        ('finance',    'Finance'),
        ('engineering','Engineering')
     ) AS dept(slug, name)
WHERE core.organization.slug = 'blankcollar-demo'
ON CONFLICT (org_id, slug) DO NOTHING;
