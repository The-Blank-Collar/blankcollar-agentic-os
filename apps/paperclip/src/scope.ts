/** Resolves the calling user's scope. Phase 0–5 stub: hardcode owner of the demo org. */

import { query } from "./db.js";
import type { Scope } from "./schemas.js";

let cached: Scope | undefined;

export async function resolveCallerScope(): Promise<Scope> {
  if (cached) return cached;

  const { rows } = await query<{ id: string }>(
    "SELECT id FROM core.organization WHERE slug = $1",
    [process.env.PAPERCLIP_DEFAULT_ORG_SLUG ?? "blankcollar-demo"],
  );
  if (rows.length === 0) {
    throw new Error(
      "Demo org not found in core.organization — did init.sql run? See docs/LOCAL_SETUP.md.",
    );
  }
  cached = {
    org_id: rows[0]!.id,
    department_id: null,
    goal_id: null,
    role: "owner",
  };
  return cached;
}

export function clearScopeCache(): void {
  cached = undefined;
}
