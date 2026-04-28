/**
 * Resolve the caller's scope.
 *
 * Precedence (first match wins):
 *   1. `request.bcScope` set by the Supabase auth preHandler (Phase 6).
 *   2. The legacy stub: owner of the demo org (Phase 0–5 default).
 */

import type { FastifyRequest } from "fastify";

import { query } from "./db.js";
import type { Scope } from "./schemas.js";

let cachedStub: Scope | undefined;

async function loadStubScope(): Promise<Scope> {
  if (cachedStub) return cachedStub;

  const { rows } = await query<{ id: string }>(
    "SELECT id FROM core.organization WHERE slug = $1",
    [process.env.PAPERCLIP_DEFAULT_ORG_SLUG ?? "blankcollar-demo"],
  );
  if (rows.length === 0) {
    throw new Error(
      "Demo org not found in core.organization — did init.sql run? See docs/LOCAL_SETUP.md.",
    );
  }
  cachedStub = {
    org_id: rows[0]!.id,
    department_id: null,
    goal_id: null,
    role: "owner",
  };
  return cachedStub;
}

export async function resolveCallerScope(req?: FastifyRequest): Promise<Scope> {
  if (req?.bcScope) return req.bcScope;
  return loadStubScope();
}

export function clearScopeCache(): void {
  cachedStub = undefined;
}
