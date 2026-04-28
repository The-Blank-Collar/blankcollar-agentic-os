/**
 * On startup, ensure the demo org has one active agent of each kind we ship.
 * Idempotent — safe to call on every boot.
 */

import { audit } from "./audit.js";
import { tx } from "./db.js";
import { resolveCallerScope } from "./scope.js";

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
