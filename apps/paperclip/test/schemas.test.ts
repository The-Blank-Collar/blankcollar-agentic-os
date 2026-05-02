import { describe, expect, it } from "vitest";

import {
  AgentCreate,
  DocumentMarkdownCreate,
  GoalCreate,
  GoalListQuery,
  GoalPatch,
  RunDispatch,
  RunFeedbackCreate,
  Scope,
} from "../src/schemas.js";

describe("Scope", () => {
  it("accepts a minimal owner scope", () => {
    const r = Scope.safeParse({
      org_id: "11111111-1111-1111-1111-111111111111",
      role: "owner",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown roles", () => {
    const r = Scope.safeParse({
      org_id: "11111111-1111-1111-1111-111111111111",
      role: "ceo",
    });
    expect(r.success).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    const r = Scope.safeParse({
      org_id: "11111111-1111-1111-1111-111111111111",
      role: "owner",
      sneak: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("GoalCreate", () => {
  it("requires a non-empty title", () => {
    expect(GoalCreate.safeParse({}).success).toBe(false);
    expect(GoalCreate.safeParse({ title: "" }).success).toBe(false);
    expect(GoalCreate.safeParse({ title: "Hi" }).success).toBe(true);
  });

  it("caps title and description length", () => {
    const longTitle = "a".repeat(201);
    expect(GoalCreate.safeParse({ title: longTitle }).success).toBe(false);
    const longDesc = "b".repeat(5_001);
    expect(GoalCreate.safeParse({ title: "ok", description: longDesc }).success).toBe(false);
  });
});

describe("GoalPatch", () => {
  it("accepts a status transition", () => {
    expect(GoalPatch.safeParse({ status: "active" }).success).toBe(true);
    expect(GoalPatch.safeParse({ status: "yo" }).success).toBe(false);
  });
});

describe("GoalListQuery", () => {
  it("coerces limit from string and defaults to 50", () => {
    const r = GoalListQuery.parse({ limit: "10" });
    expect(r.limit).toBe(10);
    const def = GoalListQuery.parse({});
    expect(def.limit).toBe(50);
  });
  it("coerces stalled_for_days from string", () => {
    const r = GoalListQuery.parse({ stalled_for_days: "7" });
    expect(r.stalled_for_days).toBe(7);
  });
  it("rejects stalled_for_days < 1", () => {
    expect(GoalListQuery.safeParse({ stalled_for_days: 0 }).success).toBe(false);
  });
});

describe("RunDispatch", () => {
  it("requires a non-negative integer subtask_index", () => {
    expect(RunDispatch.safeParse({ subtask_index: 0 }).success).toBe(true);
    expect(RunDispatch.safeParse({ subtask_index: -1 }).success).toBe(false);
    expect(RunDispatch.safeParse({ subtask_index: 1.5 }).success).toBe(false);
  });
  it("defaults mode to 'live'", () => {
    expect(RunDispatch.parse({ subtask_index: 0 }).mode).toBe("live");
  });
  it("accepts mode='simulation'", () => {
    expect(RunDispatch.parse({ subtask_index: 0, mode: "simulation" }).mode).toBe("simulation");
  });
  it("rejects unknown modes", () => {
    expect(RunDispatch.safeParse({ subtask_index: 0, mode: "wat" }).success).toBe(false);
  });
});

describe("RunFeedbackCreate", () => {
  it("clamps rating to 1..5", () => {
    expect(RunFeedbackCreate.safeParse({ rating: 0 }).success).toBe(false);
    expect(RunFeedbackCreate.safeParse({ rating: 6 }).success).toBe(false);
    expect(RunFeedbackCreate.safeParse({ rating: 3 }).success).toBe(true);
  });
  it("rejects fractional ratings", () => {
    expect(RunFeedbackCreate.safeParse({ rating: 3.5 }).success).toBe(false);
  });
  it("defaults tags to empty array", () => {
    const r = RunFeedbackCreate.parse({ rating: 4 });
    expect(r.tags).toEqual([]);
  });
  it("caps tag count at 10", () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    expect(RunFeedbackCreate.safeParse({ rating: 4, tags: tooMany }).success).toBe(false);
  });
  it("caps note length at 2000 chars", () => {
    const long = "x".repeat(2_001);
    expect(RunFeedbackCreate.safeParse({ rating: 4, note: long }).success).toBe(false);
  });
});

describe("AgentCreate", () => {
  it("defaults config to empty object", () => {
    const r = AgentCreate.parse({ kind: "hermes", name: "Hermes — Marketing" });
    expect(r.config).toEqual({});
  });
});

describe("DocumentMarkdownCreate", () => {
  it("requires title and content_md", () => {
    expect(DocumentMarkdownCreate.safeParse({}).success).toBe(false);
    expect(DocumentMarkdownCreate.safeParse({ title: "x" }).success).toBe(false);
  });
  it("defaults mime_type, scope, tags, force", () => {
    const r = DocumentMarkdownCreate.parse({ title: "X", content_md: "hello" });
    expect(r.mime_type).toBe("text/markdown");
    expect(r.scope).toBe("company");
    expect(r.tags).toEqual([]);
    expect(r.force).toBe(false);
  });
  it("rejects content_md > 1MB", () => {
    const huge = "x".repeat(1_000_001);
    expect(DocumentMarkdownCreate.safeParse({ title: "X", content_md: huge }).success).toBe(false);
  });
  it("rejects malformed source_url", () => {
    expect(
      DocumentMarkdownCreate.safeParse({
        title: "X", content_md: "y", source_url: "not a url",
      }).success,
    ).toBe(false);
  });
  it("caps tag count at 20", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(
      DocumentMarkdownCreate.safeParse({ title: "X", content_md: "y", tags: tooMany }).success,
    ).toBe(false);
  });
  it("accepts force=true", () => {
    const r = DocumentMarkdownCreate.parse({ title: "X", content_md: "y", force: true });
    expect(r.force).toBe(true);
  });
});
