import { describe, expect, it } from "vitest";

import { deriveFromAnswers } from "../src/onboarding/derive.js";

describe("deriveFromAnswers (single_user)", () => {
  it("extracts voice words from Q7", () => {
    const d = deriveFromAnswers(
      [{ question_id: "Q7", answer: "Plain, warm, and a bit dry — never playful." }],
      "single_user",
    );
    expect(d.voice_words).toEqual(expect.arrayContaining(["plain", "warm", "dry"]));
    expect(d.voice_words).not.toContain("playful");
  });

  it("parses briefing hour from Q6 with am/pm", () => {
    expect(
      deriveFromAnswers([{ question_id: "Q6", answer: "8am, paragraph please" }], "single_user").briefing_hour_utc,
    ).toBe(8);
    expect(
      deriveFromAnswers([{ question_id: "Q6", answer: "9 pm" }], "single_user").briefing_hour_utc,
    ).toBe(21);
  });

  it("recognises channels mentioned in Q3", () => {
    const d = deriveFromAnswers(
      [{ question_id: "Q3", answer: "mostly email and slack, sometimes WhatsApp" }],
      "single_user",
    );
    expect(d.channels).toEqual(expect.arrayContaining(["email", "slack", "whatsapp"]));
  });

  it("captures routine hints from Q4", () => {
    const d = deriveFromAnswers(
      [{ question_id: "Q4", answer: "every Monday I write the newsletter, and a weekly retro" }],
      "single_user",
    );
    expect(d.routine_hints.length).toBeGreaterThan(0);
  });
});

describe("deriveFromAnswers (multi_user)", () => {
  it("extracts departments from C2", () => {
    const d = deriveFromAnswers(
      [{ question_id: "C2", answer: "Three founders. Marketing, Sales, Engineering." }],
      "multi_user",
    );
    expect(d.departments).toEqual(expect.arrayContaining(["marketing", "sales", "engineering"]));
  });

  it("parses banned-words list from C7", () => {
    const d = deriveFromAnswers(
      [{ question_id: "C7", answer: "Plain, warm, precise. Banned words: leverage, synergy, disrupt." }],
      "multi_user",
    );
    expect(d.banned_words).toEqual(expect.arrayContaining(["leverage", "synergy", "disrupt"]));
  });
});
