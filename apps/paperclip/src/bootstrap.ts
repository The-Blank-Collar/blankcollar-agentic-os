/**
 * On startup, ensure the demo org has one active agent of each kind we ship.
 * Idempotent — safe to call on every boot.
 */

import { audit } from "./audit.js";
import { query, tx } from "./db.js";
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
    const created = await tx(async (client) => {
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
