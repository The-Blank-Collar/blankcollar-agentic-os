import { describe, expect, it } from "vitest";

import { classify } from "../src/routes/captures.js";

describe("capture classifier", () => {
  it("classifies a one-off task as ephemeral", () => {
    const r = classify("Reply to Mira about the Lark proposal by tomorrow");
    expect(r.kind).toBe("ephemeral");
    expect(r.title).toContain("Mira");
  });

  it("classifies a recurring task as routine and infers cron", () => {
    const r = classify("Every Monday morning, summarise the weekend in my inboxes");
    expect(r.kind).toBe("routine");
    expect(r.cron_expr).toBe("0 8 * * 1");
  });

  it("classifies a yes/no as decision", () => {
    const r = classify("Should I extend the offer to candidate C-019?");
    expect(r.kind).toBe("decision");
  });

  it("classifies a confirm/sign-off as decision", () => {
    const r = classify("Approve the milestone payout for Lark");
    expect(r.kind).toBe("decision");
  });

  it("classifies a target+horizon as standing", () => {
    const r = classify("Grow the newsletter to 10k subscribers by Q3");
    expect(r.kind).toBe("standing");
    expect(r.target_value).toMatch(/10k/i);
  });

  it("standing requires both a target and a horizon", () => {
    const r = classify("Grow the newsletter to 10k subscribers");
    expect(r.kind).toBe("ephemeral"); // no horizon — falls through
  });

  it("infers daily cron from 'every morning'", () => {
    const r = classify("Every morning brief me on overnight inbox activity");
    expect(r.kind).toBe("routine");
    expect(r.cron_expr).toBe("0 8 * * *");
  });

  it("infers Friday cron from 'every Friday evening'", () => {
    const r = classify("Every Friday evening, send me a weekly summary");
    expect(r.kind).toBe("routine");
    expect(r.cron_expr).toBe("0 18 * * 5");
  });

  it("preserves long captures verbatim but truncates the title", () => {
    const long = "Reply to Mira ".repeat(40);
    const r = classify(long);
    expect(r.title.length).toBeLessThanOrEqual(200);
    expect(r.title).toMatch(/Mira/);
  });
});
