import { describe, expect, it } from "vitest";

import { computeKrStatus, parseNumeric, rollupProgress } from "../src/skills/kr_progress.js";

describe("parseNumeric", () => {
  it("strips currency + commas", () => {
    expect(parseNumeric("$1,200")).toBe(1200);
    expect(parseNumeric("$1.5")).toBe(1.5);
  });
  it("expands k / m / b suffixes", () => {
    expect(parseNumeric("10k")).toBe(10_000);
    expect(parseNumeric("$1.2M")).toBe(1_200_000);
    expect(parseNumeric("3B")).toBe(3_000_000_000);
  });
  it("treats percent as the literal number", () => {
    expect(parseNumeric("85%")).toBe(85);
  });
  it("returns null for unparseable values", () => {
    expect(parseNumeric("achieved")).toBeNull();
    expect(parseNumeric("")).toBeNull();
    expect(parseNumeric(null)).toBeNull();
  });
});

describe("computeKrStatus", () => {
  it("achieved when current numerically meets target", () => {
    expect(computeKrStatus("10k", "10k")).toBe("achieved");
    expect(computeKrStatus("12k", "10k")).toBe("achieved");
    expect(computeKrStatus("$1.5M", "$1.2M")).toBe("achieved");
  });
  it("in_progress when current is below target", () => {
    expect(computeKrStatus("8k", "10k")).toBe("in_progress");
  });
  it("achieved on string equality fallback", () => {
    expect(computeKrStatus("complete", "Complete")).toBe("achieved");
  });
  it("unknown when no target", () => {
    expect(computeKrStatus("anything", null)).toBe("unknown");
  });
  it("in_progress when target set but no current", () => {
    expect(computeKrStatus(null, "10k")).toBe("in_progress");
  });
});

describe("rollupProgress", () => {
  it("returns 0 for an empty list", () => {
    expect(rollupProgress([])).toBe(0);
  });
  it("uses min(current/target, 1) for numeric KRs", () => {
    expect(
      rollupProgress([
        { current_value: "5k", target_value: "10k", weight: 1 },
        { current_value: "10k", target_value: "10k", weight: 1 },
      ]),
    ).toBe(75);
  });
  it("respects weights", () => {
    // Two KRs, one fully done (weight 3), one half (weight 1).
    // Weighted = (3*1 + 1*0.5) / 4 = 0.875 → 88
    expect(
      rollupProgress([
        { current_value: "10k", target_value: "10k", weight: 3 },
        { current_value: "5", target_value: "10", weight: 1 },
      ]),
    ).toBe(88);
  });
  it("treats string-only KRs as 0/1", () => {
    expect(
      rollupProgress([
        { current_value: "complete", target_value: "complete", weight: 1 },
        { current_value: "draft", target_value: "complete", weight: 1 },
      ]),
    ).toBe(50);
  });
  it("ignores zero or negative weights, falling back to 1", () => {
    expect(
      rollupProgress([
        { current_value: "10k", target_value: "10k", weight: 0 },
      ]),
    ).toBe(100);
  });
});
