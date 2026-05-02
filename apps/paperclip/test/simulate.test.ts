/**
 * Unit tests for the simulation classifier (apps/paperclip/src/runs/simulate.ts).
 *
 * No real DB — we stub a pg.PoolClient with a `query()` that returns the
 * canned skill registry for each test.
 */

import type { PoolClient, QueryResult } from "pg";
import { describe, expect, it } from "vitest";

import { simulateDispatch } from "../src/runs/simulate.js";

function fakeClient(skills: Record<string, "read" | "write" | "external">): PoolClient {
  const query = ((sql: string, params?: unknown[]) => {
    // Only one shape of query lands here: skill lookup by slug.
    const slug = (params?.[0] ?? "") as string;
    const eff = skills[slug];
    const rows = eff ? [{ side_effects: eff }] : [];
    return Promise.resolve({ rows, rowCount: rows.length } as unknown as QueryResult);
  }) as unknown as PoolClient["query"];
  return { query } as unknown as PoolClient;
}

describe("simulateDispatch", () => {
  const ORG = "00000000-0000-0000-0000-000000000001";

  it("classifies a read-only skill as would-execute", async () => {
    const client = fakeClient({ "web.fetch": "read" });
    const r = await simulateDispatch(client, ORG, [
      { index: 0, title: "Fetch news", skill: "web.fetch", input: { url: "x" } },
    ]);
    expect(r.subtask_count).toBe(1);
    expect(r.would_execute).toBe(1);
    expect(r.would_have_mutated).toBe(0);
    expect(r.subtasks[0]?.outcome).toBe("would-execute");
    expect(r.subtasks[0]?.side_effects).toBe("read");
  });

  it("classifies an external-effect skill as would-have-mutated", async () => {
    const client = fakeClient({ "email.send": "external" });
    const r = await simulateDispatch(client, ORG, [
      { index: 0, title: "Email Mira", skill: "email.send", input: { to: "mira@x" } },
    ]);
    expect(r.would_execute).toBe(0);
    expect(r.would_have_mutated).toBe(1);
    expect(r.subtasks[0]?.outcome).toBe("would-have-mutated");
    expect(r.subtasks[0]?.reason).toContain("external");
  });

  it("classifies a write skill as would-have-mutated", async () => {
    const client = fakeClient({ "knowledge.upsert": "write" });
    const r = await simulateDispatch(client, ORG, [
      { index: 0, title: "Upsert doc", skill: "knowledge.upsert", input: {} },
    ]);
    expect(r.would_have_mutated).toBe(1);
    expect(r.subtasks[0]?.reason).toContain("Mutating".toLowerCase()); // "mutating —"
  });

  it("default-denies a subtask with no skill declared", async () => {
    const client = fakeClient({});
    const r = await simulateDispatch(client, ORG, [{ index: 0, title: "Mystery" }]);
    expect(r.would_have_mutated).toBe(1);
    expect(r.subtasks[0]?.outcome).toBe("would-have-mutated");
    expect(r.subtasks[0]?.reason).toContain("default-deny");
  });

  it("default-denies a skill missing from the registry", async () => {
    const client = fakeClient({});
    const r = await simulateDispatch(client, ORG, [
      { index: 0, title: "?", skill: "ghost.skill" },
    ]);
    expect(r.would_have_mutated).toBe(1);
    expect(r.subtasks[0]?.reason).toContain("ghost.skill");
    expect(r.subtasks[0]?.reason).toContain("default-deny");
  });

  it("rolls up across a mixed plan", async () => {
    const client = fakeClient({
      "web.fetch": "read",
      "email.send": "external",
      "knowledge.lookup": "read",
      "payment.charge": "external",
    });
    const r = await simulateDispatch(client, ORG, [
      { index: 0, skill: "web.fetch" },
      { index: 1, skill: "knowledge.lookup" },
      { index: 2, skill: "email.send" },
      { index: 3, skill: "payment.charge" },
    ]);
    expect(r.subtask_count).toBe(4);
    expect(r.would_execute).toBe(2);
    expect(r.would_have_mutated).toBe(2);
  });

  it("preserves original input under preview field", async () => {
    const client = fakeClient({ "email.send": "external" });
    const r = await simulateDispatch(client, ORG, [
      { index: 0, skill: "email.send", input: { to: "x@y", subject: "Hi" } },
    ]);
    expect(r.subtasks[0]?.preview).toEqual({ to: "x@y", subject: "Hi" });
  });

  it("falls back from input to inputs key (some plans use either)", async () => {
    const client = fakeClient({ "email.send": "external" });
    const r = await simulateDispatch(client, ORG, [
      { index: 0, skill: "email.send", inputs: { to: "alt" } },
    ]);
    expect(r.subtasks[0]?.preview).toEqual({ to: "alt" });
  });

  it("uses the array index when subtask.index is missing", async () => {
    const client = fakeClient({ "web.fetch": "read" });
    const r = await simulateDispatch(client, ORG, [
      { skill: "web.fetch" },
      { skill: "web.fetch" },
    ]);
    expect(r.subtasks[0]?.index).toBe(0);
    expect(r.subtasks[1]?.index).toBe(1);
  });
});
