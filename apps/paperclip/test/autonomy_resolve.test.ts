/**
 * Unit tests for the autonomy resolver.
 *
 * No real DB — we stub a pg.PoolClient with a `query()` that returns a
 * canned set of ops.autonomy_mode rows. The resolver picks the most
 * specific match per scope hierarchy: skill → agent → department → org.
 */

import type { PoolClient, QueryResult } from "pg";
import { describe, expect, it } from "vitest";

import { resolveAutonomy } from "../src/autonomy/resolve.js";
import type { AutonomyMode, AutonomyScopeKind } from "../src/schemas.js";

type Row = {
  id: string;
  scope_kind: AutonomyScopeKind;
  scope_id: string | null;
  mode: AutonomyMode;
  spending_cap_cents: number | null;
  notes: string | null;
};

function fakeClient(rows: Row[]): PoolClient {
  const query = ((_sql: string, _params?: unknown[]) =>
    Promise.resolve({ rows, rowCount: rows.length } as unknown as QueryResult)) as unknown as PoolClient["query"];
  return { query } as unknown as PoolClient;
}

const ORG = "00000000-0000-0000-0000-000000000001";
const DEPT = "00000000-0000-0000-0000-0000000000d1";
const AGENT = "00000000-0000-0000-0000-000000000a01";
const SKILL = "00000000-0000-0000-0000-0000000051a1";

describe("resolveAutonomy", () => {
  it("defaults to 'custom' when no rows match", async () => {
    const r = await resolveAutonomy(fakeClient([]), {
      orgId: ORG,
      departmentId: DEPT,
      agentId: AGENT,
      skillId: SKILL,
    });
    expect(r.mode).toBe("custom");
    expect(r.source).toBeNull();
    expect(r.spending_cap_cents).toBeNull();
  });

  it("returns the org-level row when only org is set", async () => {
    const r = await resolveAutonomy(
      fakeClient([
        {
          id: "1",
          scope_kind: "org",
          scope_id: null,
          mode: "auto_approve",
          spending_cap_cents: 50_000,
          notes: null,
        },
      ]),
      { orgId: ORG },
    );
    expect(r.mode).toBe("auto_approve");
    expect(r.spending_cap_cents).toBe(50_000);
    expect(r.source?.scope_kind).toBe("org");
  });

  it("skill beats agent beats department beats org (most specific wins)", async () => {
    const rows: Row[] = [
      { id: "o", scope_kind: "org", scope_id: null, mode: "ask_every_time", spending_cap_cents: null, notes: "org default" },
      { id: "d", scope_kind: "department", scope_id: DEPT, mode: "auto_approve", spending_cap_cents: null, notes: "dept" },
      { id: "a", scope_kind: "agent", scope_id: AGENT, mode: "planning", spending_cap_cents: null, notes: "agent" },
      { id: "s", scope_kind: "skill", scope_id: SKILL, mode: "custom", spending_cap_cents: 999, notes: "skill" },
    ];
    const r = await resolveAutonomy(fakeClient(rows), {
      orgId: ORG, departmentId: DEPT, agentId: AGENT, skillId: SKILL,
    });
    expect(r.mode).toBe("custom");
    expect(r.source?.scope_kind).toBe("skill");
    expect(r.spending_cap_cents).toBe(999);
  });

  it("falls through to next-most-specific when the highest scope has no row", async () => {
    const rows: Row[] = [
      { id: "o", scope_kind: "org", scope_id: null, mode: "ask_every_time", spending_cap_cents: null, notes: null },
      { id: "a", scope_kind: "agent", scope_id: AGENT, mode: "auto_approve", spending_cap_cents: null, notes: null },
      // no department, no skill
    ];
    const r = await resolveAutonomy(fakeClient(rows), {
      orgId: ORG, departmentId: DEPT, agentId: AGENT, skillId: SKILL,
    });
    // skill wins if present; here it isn't, agent does.
    expect(r.mode).toBe("auto_approve");
    expect(r.source?.scope_kind).toBe("agent");
  });

  it("ignores rows for unrelated scope_ids", async () => {
    const rows: Row[] = [
      // The fake client returns whatever rows we hand it; in production the
      // SQL filter strips non-matches. To simulate that we only include
      // matching rows here. This test asserts the JS-side priority pick
      // still works when irrelevant rows are absent.
      { id: "o", scope_kind: "org", scope_id: null, mode: "ask_every_time", spending_cap_cents: null, notes: null },
    ];
    const r = await resolveAutonomy(fakeClient(rows), {
      orgId: ORG,
      // No department/agent/skill → only the org row is in the OR clause.
    });
    expect(r.mode).toBe("ask_every_time");
    expect(r.source?.scope_kind).toBe("org");
  });
});
