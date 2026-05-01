/**
 * Tool registry — keeps `ops.tool` in sync with the on-disk manifests.
 *
 * Boot flow mirrors `skills/registry.ts`: read every YAML, upsert shared
 * manifests with org_id=NULL. Company/personal-scoped manifests are
 * seed templates materialised on demand by onboarding.
 */

import { withSystemScope } from "../db.js";
import { type LoadedTool, loadToolManifests } from "./loader.js";

type Logger = {
  info: (m: string) => void;
  warn?: (m: string) => void;
  error?: (e: unknown, m: string) => void;
};

export async function syncToolRegistry(log: Logger): Promise<number> {
  const manifests = await loadToolManifests(log);
  let upserts = 0;
  for (const m of manifests) {
    if (m.scope !== "shared") continue;
    try {
      await upsertShared(m);
      upserts++;
    } catch (err) {
      log.error?.(err, `[tools] upsert failed for ${m.id}`);
    }
  }
  log.info(`[tools] registry synced — ${upserts} shared tool(s) upserted into ops.tool`);
  return upserts;
}

async function upsertShared(m: LoadedTool): Promise<void> {
  // org_id IS NULL → matches every org via the policy's NULL-pass branch.
  // Use withSystemScope so the upsert isn't blocked when the boot caller
  // hasn't bound a tenant.
  await withSystemScope(async (client) => {
    await client.query(
      `INSERT INTO ops.tool (
         org_id, slug, version, scope, name, description, transport, target,
         env_keys, input_schema, manifest_path, enabled
       )
       VALUES (NULL, $1, $2, 'shared'::ops.skill_scope, $3, $4, $5::ops.tool_transport, $6,
               $7::jsonb, $8::jsonb, $9, true)
       ON CONFLICT (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug, version)
       DO UPDATE SET
         name          = EXCLUDED.name,
         description   = EXCLUDED.description,
         transport     = EXCLUDED.transport,
         target        = EXCLUDED.target,
         env_keys      = EXCLUDED.env_keys,
         input_schema  = EXCLUDED.input_schema,
         manifest_path = EXCLUDED.manifest_path,
         updated_at    = now()`,
      [
        m.id,
        m.version,
        m.name,
        m.description ?? null,
        m.transport,
        m.target,
        JSON.stringify(m.env_keys),
        JSON.stringify(m.input_schema),
        m.manifest_path,
      ],
    );
  });
}
