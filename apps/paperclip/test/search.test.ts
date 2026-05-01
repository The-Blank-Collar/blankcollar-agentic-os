import { describe, expect, it } from "vitest";

import { scoreOf, snippet } from "../src/routes/search.js";

describe("search scoreOf", () => {
  it("title match beats body match", () => {
    const tHit = scoreOf("Lark proposal", "general body text", "lark");
    const bHit = scoreOf("Acme thing", "the lark proposal arrived", "lark");
    expect(tHit).toBeGreaterThan(bHit);
  });
  it("returns 0 for no match", () => {
    expect(scoreOf("Acme", "nothing here", "lark")).toBe(0);
  });
  it("matches case-insensitively", () => {
    expect(scoreOf("LARK proposal", null, "lark")).toBe(10);
  });
  it("counts both title and body", () => {
    expect(scoreOf("lark", "lark again", "lark")).toBe(11);
  });
  it("handles null fields", () => {
    expect(scoreOf(null, null, "lark")).toBe(0);
    expect(scoreOf(null, "lark here", "lark")).toBe(1);
  });
});

describe("search snippet", () => {
  it("returns null for null text", () => {
    expect(snippet(null, "x")).toBeNull();
  });
  it("returns the head when no match", () => {
    const text = "this is a long string ".repeat(20);
    const s = snippet(text, "missing");
    expect(s?.length).toBeLessThanOrEqual(140);
    expect(s).not.toContain("…");
  });
  it("centers the window on the match", () => {
    const filler = "lorem ipsum dolor sit amet ".repeat(10);
    const text = filler + "MATCH" + filler;
    const s = snippet(text, "MATCH");
    expect(s).toContain("MATCH");
    expect(s?.startsWith("…")).toBe(true);
    expect(s?.endsWith("…")).toBe(true);
  });
  it("does not prefix ellipsis when match is at the head", () => {
    const s = snippet("MATCH at the start of a long body", "MATCH");
    expect(s?.startsWith("…")).toBe(false);
  });
});
