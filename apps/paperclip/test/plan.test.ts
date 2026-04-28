import { describe, expect, it } from "vitest";

import { generatePlan } from "../src/plan.js";

describe("generatePlan — generic", () => {
  it("produces non-empty subtasks for any goal", () => {
    const plan = generatePlan({ title: "Reach 1000 subscribers" });
    expect(plan.length).toBeGreaterThan(0);
    for (const s of plan) {
      expect(s.title).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(typeof s.index).toBe("number");
      expect(["hermes", "openclaw"]).toContain(s.agent_kind);
    }
  });

  it("indexes subtasks sequentially from 0", () => {
    const plan = generatePlan({ title: "Anything" });
    plan.forEach((s, i) => expect(s.index).toBe(i));
  });

  it("includes the goal title in the first subtask context", () => {
    const plan = generatePlan({ title: "Win the world", description: "by Friday" });
    expect(plan[0]!.input.goal_title).toBe("Win the world");
    expect(plan[0]!.input.goal_context).toBe("by Friday");
  });

  it("trims whitespace in inputs", () => {
    const plan = generatePlan({ title: "  Hi  ", description: "  there  " });
    expect(plan[0]!.input.goal_title).toBe("Hi");
    expect(plan[0]!.input.goal_context).toBe("there");
  });

  it("defaults the generic plan to Hermes-only steps", () => {
    const plan = generatePlan({ title: "Improve onboarding" });
    expect(plan.every((s) => s.agent_kind === "hermes")).toBe(true);
  });
});

describe("generatePlan — URL-aware", () => {
  it("recognises a URL in the title and produces fetch → summarise → decision", () => {
    const plan = generatePlan({
      title: "Summarise https://news.ycombinator.com/ for me",
    });
    expect(plan.length).toBe(3);
    expect(plan[0]!.agent_kind).toBe("openclaw");
    expect(plan[0]!.input.skill).toBe("web.fetch");
    expect(plan[0]!.input.url).toBe("https://news.ycombinator.com/");
    expect(plan[1]!.agent_kind).toBe("hermes");
    expect(plan[2]!.agent_kind).toBe("hermes");
  });

  it("recognises a URL in the description", () => {
    const plan = generatePlan({
      title: "Brief me on the page",
      description: "Source: http://example.com/article",
    });
    expect(plan[0]!.agent_kind).toBe("openclaw");
    expect(plan[0]!.input.url).toBe("http://example.com/article");
  });

  it("URL extraction stops at whitespace", () => {
    const plan = generatePlan({ title: "See https://example.com/path now" });
    expect(String(plan[0]!.input.url)).toBe("https://example.com/path");
  });
});

describe("generatePlan — search-aware", () => {
  it("routes 'research X' to OpenClaw web.search", () => {
    const plan = generatePlan({ title: "Research the best CRM for SaaS startups" });
    expect(plan[0]!.agent_kind).toBe("openclaw");
    expect(plan[0]!.input.skill).toBe("web.search");
    expect(plan[0]!.input.query).toMatch(/Research/);
    expect(plan[1]!.agent_kind).toBe("hermes");
    expect(plan[2]!.agent_kind).toBe("hermes");
  });

  it("routes 'find/look up' phrasing to web.search", () => {
    const plan = generatePlan({ title: "Find competitors for our pricing page" });
    expect(plan[0]!.input.skill).toBe("web.search");
  });

  it("a URL still wins over search keywords", () => {
    const plan = generatePlan({
      title: "Research https://news.ycombinator.com/",
    });
    expect(plan[0]!.input.skill).toBe("web.fetch");
  });
});
