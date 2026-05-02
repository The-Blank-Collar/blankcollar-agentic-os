/**
 * Tool registry — keeps `ops.tool` in sync with the on-disk manifests.
 *
 * Boot flow mirrors `skills/registry.ts`: read every YAML, upsert shared
 * manifests with org_id=NULL. Company/personal-scoped manifests are
 * seed templates materialised on demand by onboarding.
 */

import { withSystemScope } from "../db.js";
import { probeStdioTool } from "./client.js";
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

/**
 * Sequentially probe every enabled stdio tool in `ops.tool`. Tools that
 * fail their `initialize` handshake get `enabled = false`; healthy tools
 * stay as-is. Designed to run in the background after boot so it never
 * blocks the listener.
 *
 * Safe to call repeatedly; idempotent. Skips tools already disabled.
 */
export async function probeRegisteredTools(log: Logger): Promise<{
  probed: number;
  ok: number;
  disabled: number;
}> {
  const tools = await withSystemScope(async (client) => {
    const { rows } = await client.query<{ id: string; slug: string; target: string }>(
      `SELECT id, slug, target FROM ops.tool
        WHERE transport = 'stdio'::ops.tool_transport
          AND enabled = true`,
    );
    return rows;
  });
  let ok = 0;
  let disabled = 0;
  for (const t of tools) {
    const result = await probeStdioTool({ command: t.target });
    if (result.ok) {
      ok++;
      continue;
    }
    disabled++;
    log.warn?.(
      `[tools] probe failed for ${t.slug}: ${result.error ?? "(unknown)"} ` +
        `— disabling automatically`,
    );
    await withSystemScope(async (client) => {
      await client.query(
        `UPDATE ops.tool SET enabled = false, updated_at = now() WHERE id = $1`,
        [t.id],
      );
    });
  }
  log.info(`[tools] probe complete — ${ok} healthy / ${disabled} auto-disabled / ${tools.length} total`);
  return { probed: tools.length, ok, disabled };
}

async function upsertShared(m: LoadedTool): Promise<void> {
  // org_id IS NULL → matches every org via the policy's NULL-pass branch.
  // Use withSystemScope so the upsert isn't blocked when the boot caller
  // hasn't bound a tenant.
  await withSystemScope(async (client) => {
    await client.query(
      `INSERT INTO ops.tool (
         org_id, slug, version, scope, name, description, transport, target,
         env_keys, input_schema, tool_name, manifest_path, enabled
       )
       VALUES (NULL, $1, $2, 'shared'::ops.skill_scope, $3, $4, $5::ops.tool_transport, $6,
               $7::jsonb, $8::jsonb, $9, $10, true)
       ON CONFLICT (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug, version)
       DO UPDATE SET
         name          = EXCLUDED.name,
         description   = EXCLUDED.description,
         transport     = EXCLUDED.transport,
         target        = EXCLUDED.target,
         env_keys      = EXCLUDED.env_keys,
         input_schema  = EXCLUDED.input_schema,
         tool_name     = EXCLUDED.tool_name,
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
        m.tool_name ?? null,
        m.manifest_path,
      ],
    );
  });
}
