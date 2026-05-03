/**
 * Unit tests for the Chief of Staff planner.
 *
 *   fallbackDecompose  — used when Portkey isn't configured. Pure;
 *                         single-step plan = the whole goal.
 *   sanitiseChiefPlan  — runs after the LLM returns. Must clamp every
 *                         field so a hostile / malformed LLM response
 *                         can't corrupt the DAG.
 *
 * The full LLM round-trip is exercised by `./infra/scripts/smoke.sh`.
 */

import { describe, expect, it } from "vitest";

import { fallbackDecompose, sanitiseChiefPlan } from "../src/swarms/chief.js";

describe("fallbackDecompose", () => {
  it("returns a single-step plan when Portkey is not configured", () => {
    const r = fallbackDecompose({ title: "Launch the spring catalogue" });
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]?.ordinal).toBe(1);
    expect(r.steps[0]?.depends_on_ordinals).toEqual([]);
    expect(r.warnings.some((w) => w.includes("Portkey"))).toBe(true);
  });

  it("uses description for the instruction when present", () => {
    const r = fallbackDecompose({
      title: "Send newsletter",
      description: "Draft + send to 4,200 subscribers; check open rate.",
    });
    expect(r.steps[0]?.instruction).toContain("Draft");
  });

  it("clamps very long titles and descriptions", () => {
    const big = "x".repeat(2_000);
    const r = fallbackDecompose({ title: big, description: big });
    expect(r.steps[0]?.title.length).toBeLessThanOrEqual(200);
    expect(r.steps[0]?.instruction.length).toBeLessThanOrEqual(1_000);
  });
});

describe("sanitiseChiefPlan — defensive against bad LLM output", () => {
  const REGISTRY = [
    { slug: "email.send", agent_kind: "openclaw" },
    { slug: "web.fetch", agent_kind: "openclaw" },
  ];
  const INPUT = { title: "Demo goal", description: null, registry: REGISTRY };

  it("treats missing / non-array steps as a single-step fallback", () => {
    const r = sanitiseChiefPlan({}, INPUT);
    expect(r.steps).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes("no steps"))).toBe(true);
  });

  it("re-numbers ordinals 1..N regardless of LLM ordinal claims", () => {
    const r = sanitiseChiefPlan(
      {
        steps: [
          { ordinal: 17, title: "A", instruction: "do A" },
          { ordinal: 99, title: "B", instruction: "do B" },
          { ordinal: 1,  title: "C", instruction: "do C" },
        ],
      },
      INPUT,
    );
    expect(r.steps.map((s) => s.ordinal)).toEqual([1, 2, 3]);
  });

  it("drops malformed steps (no title or instruction)", () => {
    const r = sanitiseChiefPlan(
      {
        steps: [
          { title: "ok", instruction: "do it" },
          { title: "", instruction: "no title" },
          { title: "ok2", instruction: "" },
          "not an object",
          null,
        ],
      },
      INPUT,
    );
    expect(r.steps).toHaveLength(1);
  });

  it("drops skill_slug values not in the registry, with warnings", () => {
    const r = sanitiseChiefPlan(
      {
        steps: [
          {
            title: "Send",
            instruction: "send the newsletter",
            agent_kind: "openclaw",
            skill_slug: "email.send",
          },
          {
            title: "Magic",
            instruction: "do magic",
            skill_slug: "spell.cast",
          },
        ],
      },
      INPUT,
    );
    expect(r.steps[0]?.skill_slug).toBe("email.send");
    expect(r.steps[1]?.skill_slug).toBeNull();
    expect(r.warnings.some((w) => w.includes("spell.cast"))).toBe(true);
  });

  it("rejects unknown agent_kind, defaulting to hermes", () => {
    const r = sanitiseChiefPlan(
      {
        steps: [{ title: "A", instruction: "do A", agent_kind: "ALIEN AGENT" }],
      },
      INPUT,
    );
    expect(r.steps[0]?.agent_kind).toBe("hermes");
  });

  it("only accepts deps that point to a smaller (preceding) ordinal", () => {
    const r = sanitiseChiefPlan(
      {
        steps: [
          { title: "A", instruction: "do A", depends_on_ordinals: [] },
          { title: "B", instruction: "do B", depends_on_ordinals: [1] },
          // Forward dep would form a cycle; must be dropped.
          { title: "C", instruction: "do C", depends_on_ordinals: [4, 2] },
        ],
      },
      INPUT,
    );
    expect(r.steps[1]?.depends_on_ordinals).toEqual([1]);
    // Step 3 keeps the valid 2 but drops the out-of-range 4.
    expect(r.steps[2]?.depends_on_ordinals).toEqual([2]);
    expect(r.warnings.some((w) => w.includes("invalid dep 4"))).toBe(true);
  });

  it("dedupes repeated deps", () => {
    const r = sanitiseChiefPlan(
      {
        steps: [
          { title: "A", instruction: "do A", depends_on_ordinals: [] },
          { title: "B", instruction: "do B", depends_on_ordinals: [1, 1, 1] },
        ],
      },
      INPUT,
    );
    expect(r.steps[1]?.depends_on_ordinals).toEqual([1]);
  });

  it("caps at 12 steps", () => {
    const big = Array.from({ length: 30 }, (_, i) => ({
      title: `step${i}`,
      instruction: `do step ${i}`,
    }));
    const r = sanitiseChiefPlan({ steps: big }, INPUT);
    expect(r.steps.length).toBeLessThanOrEqual(12);
  });
});
