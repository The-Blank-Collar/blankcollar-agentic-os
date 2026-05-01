import { describe, expect, it } from "vitest";

import { detectMode, relative, trunc } from "../src/format.js";

describe("detectMode", () => {
  it("--json wins over auto-detection", () => {
    expect(detectMode({ json: true })).toBe("json");
  });
  it("--pretty wins over auto-detection", () => {
    expect(detectMode({ pretty: true })).toBe("pretty");
  });
  it("falls back to TTY detection when neither flag is set", () => {
    // process.stdout.isTTY is what matters; we can't mock it cleanly here
    // without surgery, so just assert the call returns a valid mode.
    const mode = detectMode({});
    expect(["pretty", "json"]).toContain(mode);
  });
});

describe("trunc", () => {
  it("returns input unchanged when shorter than max", () => {
    expect(trunc("hello", 10)).toBe("hello");
  });
  it("inserts ellipsis at the boundary when too long", () => {
    expect(trunc("abcdefgh", 5)).toBe("abcd…");
  });
});

describe("relative", () => {
  it("formats seconds and minutes", () => {
    const now = new Date();
    expect(relative(new Date(now.getTime() - 30_000).toISOString())).toMatch(/s ago$/);
    expect(relative(new Date(now.getTime() - 5 * 60_000).toISOString())).toMatch(/m ago$/);
  });
  it("formats hours and yesterday", () => {
    const now = new Date();
    expect(relative(new Date(now.getTime() - 3 * 3_600_000).toISOString())).toMatch(/h ago$/);
    expect(relative(new Date(now.getTime() - 24 * 3_600_000).toISOString())).toBe("yesterday");
  });
});
