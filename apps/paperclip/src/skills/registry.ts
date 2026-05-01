/**
 * Skill registry — keeps `ops.skill` in sync with the on-disk manifests.
 *
 * Boot flow:
 *   1. loadSkillManifests() reads YAML on disk
 *   2. syncSkillRegistry() upserts every shared manifest with org_id=NULL
 *      (global; visible to every org via the RLS policy's NULL-pass branch).
 *      Company/personal-scoped manifests on disk are seed templates — they
 *      get materialised into ops.skill on demand by the onboarding system.
 *
 * Live changes (operators dropping a YAML into manifests/company/) take
 * effect on next Paperclip boot. No hot-reload in v0.
 */

import { tx } from "../db.js";
import { type LoadedSkill, loadSkillManifests } from "./loader.js";

type Logger = { info: (m: string) => void; warn?: (m: string) => void; error?: (e: unknown, m: string) => void };

export async function syncSkillRegistry(log: Logger): Promise<number> {
  const manifests = await loadSkillManifests(log);

  let upserts = 0;
  for (const m of manifests) {
    if (m.scope !== "shared") continue;
    try {
      await upsertShared(m);
      upserts++;
    } catch (err) {
      log.error?.(err, `[skills] upsert failed for ${m.id}`);
    }
  }
  log.info(`[skills] registry synced — ${upserts} shared skill(s) upserted into ops.skill`);
  return upserts;
}

async function upsertShared(m: LoadedSkill): Promise<void> {
  // Shared skills are system-level (org_id=NULL). They predate any org and
  // outlive every org. We don't audit-log shared registrations because
  // core.audit_log.org_id is FK to core.organization — no org, no audit.
  // Operators can see registry events via the boot log line.
  await tx(async (client) => {
    await client.query(
      `INSERT INTO ops.skill (
         org_id, slug, version, scope, mode_aware, agent_kind, title, description,
         manifest_path, params_schema, side_effects, required_role, approval_under, enabled
       )
       VALUES (NULL, $1, $2, 'shared'::ops.skill_scope, $3, $4, $5, $6, $7, $8::jsonb,
               $9, $10::core.role_kind, $11, true)
       ON CONFLICT (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug, version)
       DO UPDATE SET
         mode_aware     = EXCLUDED.mode_aware,
         agent_kind     = EXCLUDED.agent_kind,
         title          = EXCLUDED.title,
         description    = EXCLUDED.description,
         manifest_path  = EXCLUDED.manifest_path,
         params_schema  = EXCLUDED.params_schema,
         side_effects   = EXCLUDED.side_effects,
         required_role  = EXCLUDED.required_role,
         approval_under = EXCLUDED.approval_under,
         updated_at     = now()`,
      [
        m.id,
        m.version,
        m.mode_aware,
        m.agent_kind,
        m.title,
        m.description ?? null,
        m.manifest_path,
        JSON.stringify(m.inputs ?? {}),
        m.side_effects,
        m.permissions?.required_role ?? null,
        m.permissions?.approval_under ?? null,
      ],
    );
  });
}
