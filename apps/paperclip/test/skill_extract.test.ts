/**
 * Unit tests for the SOP → Skill extractor.
 *
 * Two paths to cover:
 *   1. fallbackExtract — used when Portkey isn't configured. Pure markdown
 *      parsing; no network. The OSS demo + tests rely on this.
 *   2. sanitiseDraft  — runs after the LLM returns. Must clamp every field
 *      so a hostile / malformed LLM response can't corrupt the draft.
 *
 * The full LLM round-trip with Portkey is exercised by the integration
 * smoke (`./infra/scripts/smoke.sh`) — too brittle to mock here.
 */

import { describe, expect, it } from "vitest";

import { fallbackExtract, sanitiseDraft, slugify } from "../src/skills/extract.js";

describe("fallbackExtract — deterministic markdown path", () => {
  it("uses the title hint when provided", () => {
    const r = fallbackExtract({
      content_md: "## Some heading\n- step 1",
      title_hint: "Hadid proposal flow",
    });
    expect(r.title).toBe("Hadid proposal flow");
  });

  it("falls back to first H1 / H2 when no hint", () => {
    const r = fallbackExtract({
      content_md: "# Vendor onboarding\n- collect tax form\n- run KYC",
    });
    expect(r.title).toBe("Vendor onboarding");
  });

  it("turns bullets into numbered steps", () => {
    const r = fallbackExtract({
      content_md: "# Demo\n- first do X\n- then do Y\n+ finally do Z\n1. and finish",
    });
    expect(r.steps.length).toBe(4);
    expect(r.steps[0]?.n).toBe(1);
    expect(r.steps[0]?.instruction).toBe("first do X");
    expect(r.steps[3]?.n).toBe(4);
    expect(r.steps[3]?.instruction).toBe("and finish");
  });

  it("warns that the LLM was skipped", () => {
    const r = fallbackExtract({ content_md: "# x" });
    expect(r.warnings.some((w) => w.includes("Portkey"))).toBe(true);
  });

  it("emits a slug derived from the title", () => {
    const r = fallbackExtract({ content_md: "# Hadid proposal v3 — phase plan" });
    expect(/^[a-z0-9._-]+$/.test(r.proposed_slug)).toBe(true);
    expect(r.proposed_slug).toContain("hadid");
  });

  it("never throws on garbage input", () => {
    expect(() => fallbackExtract({ content_md: "" })).not.toThrow();
    expect(() => fallbackExtract({ content_md: "      " })).not.toThrow();
    expect(() => fallbackExtract({ content_md: "## ## ##" })).not.toThrow();
  });
});

describe("sanitiseDraft — defensive against bad LLM output", () => {
  const REGISTRY = [
    { slug: "email.send", description: "Send outbound email" },
    { slug: "web.fetch", description: "Fetch a URL" },
  ];
  const INPUT = { content_md: "# Demo SOP\n- step", title_hint: "Demo SOP", registry: REGISTRY };

  it("rewrites bad slugs to a clean one and warns", () => {
    const r = sanitiseDraft(
      {
        title: "Send proposals",
        proposed_slug: "Send Proposals!!!",
        steps: [],
      },
      INPUT,
    );
    expect(/^[a-z0-9._-]+$/.test(r.proposed_slug)).toBe(true);
    expect(r.warnings.some((w) => w.includes("Slug"))).toBe(true);
  });

  it("drops inferred_tools that aren't in the registry", () => {
    const r = sanitiseDraft(
      {
        title: "Demo",
        proposed_slug: "demo.flow",
        steps: [],
        inferred_tools: ["email.send", "totally.not.real", "web.fetch"],
      },
      INPUT,
    );
    expect(r.inferred_tools).toEqual(["email.send", "web.fetch"]);
    expect(r.warnings.some((w) => w.includes("Dropped"))).toBe(true);
  });

  it("clears step.tool when the tool isn't in the registry", () => {
    const r = sanitiseDraft(
      {
        title: "Demo",
        proposed_slug: "demo.flow",
        steps: [
          { n: 1, instruction: "send the email", tool: "email.send" },
          { n: 2, instruction: "do magic", tool: "wand.cast" },
        ],
      },
      INPUT,
    );
    expect(r.steps[0]?.tool).toBe("email.send");
    expect(r.steps[1]?.tool).toBeNull();
    expect(r.warnings.some((w) => w.includes("unknown tool"))).toBe(true);
  });

  it("clamps title length and provides safe defaults for missing fields", () => {
    const r = sanitiseDraft({}, INPUT);
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.title.length).toBeLessThanOrEqual(200);
    expect(r.agent_kind).toBe("hermes");
    expect(r.params_schema).toBeDefined();
    expect(typeof r.params_schema).toBe("object");
  });

  it("rejects an unknown agent_kind in favour of the default", () => {
    const r = sanitiseDraft(
      { title: "x", proposed_slug: "x.x", agent_kind: "INVALID KIND!!!" },
      INPUT,
    );
    expect(r.agent_kind).toBe("hermes");
  });

  it("filters non-object steps and steps with empty instructions", () => {
    const r = sanitiseDraft(
      {
        title: "x",
        proposed_slug: "x.x",
        steps: [
          { n: 1, instruction: "" },
          "not an object",
          { n: 2, instruction: "ok" },
          null,
        ],
      },
      INPUT,
    );
    expect(r.steps.length).toBe(1);
    expect(r.steps[0]?.instruction).toBe("ok");
  });
});

describe("slugify", () => {
  it("normalises titles to lowercase dotted form", () => {
    expect(slugify("Hadid Proposal — v3")).toMatch(/^[a-z0-9._-]+$/);
    expect(slugify("Send The Newsletter")).toContain("send");
  });

  it("returns a safe default for empty input", () => {
    expect(slugify("")).toBe("skill.untitled");
    expect(slugify("!!!")).toBe("skill.untitled");
  });
});
