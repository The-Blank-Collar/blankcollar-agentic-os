import { describe, expect, it } from "vitest";

import { generatePlan } from "../src/plan.js";

describe("generatePlan", () => {
  it("produces non-empty subtasks for any goal", () => {
    const plan = generatePlan({ title: "Reach 1000 subscribers" });
    expect(plan.length).toBeGreaterThan(0);
    for (const s of plan) {
      expect(s.title).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(typeof s.index).toBe("number");
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
});
