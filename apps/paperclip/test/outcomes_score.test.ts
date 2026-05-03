/**
 * Unit tests for the outcome scorer.
 *
 * The score function is pure (no DB, no network). The retriever's full
 * SQL path is exercised by `./infra/scripts/smoke.sh` against a live
 * Postgres — too DB-heavy to mock here.
 */

import { describe, expect, it } from "vitest";

import { scoreOutcomes, type OutcomeForScoring } from "../src/outcomes/score.js";

const baseline = (id: string): OutcomeForScoring => ({
  outcome_id: id,
  feedbacks: [],
  metrics: [],
});

describe("scoreOutcomes", () => {
  it("returns [] for empty input", () => {
    expect(scoreOutcomes([])).toEqual([]);
  });

  it("gives no-feedback / no-metric outcomes a neutral 0.5", () => {
    const r = scoreOutcomes([baseline("a"), baseline("b")]);
    for (const s of r) {
      expect(s.score).toBe(0.5);
      expect(s.has_feedback).toBe(false);
      expect(s.metric_count).toBe(0);
    }
  });

  it("maps feedback ratings 1..5 → 0..1 linearly", () => {
    const r = scoreOutcomes([
      { outcome_id: "1", feedbacks: [{ rating: 1 }], metrics: [] },
      { outcome_id: "5", feedbacks: [{ rating: 5 }], metrics: [] },
      { outcome_id: "3", feedbacks: [{ rating: 3 }], metrics: [] },
    ]);
    const byId = new Map(r.map((s) => [s.outcome_id, s]));
    expect(byId.get("1")?.score).toBe(0);
    expect(byId.get("5")?.score).toBe(1);
    expect(byId.get("3")?.score).toBe(0.5);
  });

  it("averages multiple feedbacks per outcome", () => {
    const r = scoreOutcomes([
      {
        outcome_id: "x",
        feedbacks: [{ rating: 1 }, { rating: 5 }],
        metrics: [],
      },
    ]);
    expect(r[0]?.score).toBe(0.5); // mean rating 3 → 0.5
  });

  it("normalizes higher_is_better metrics across the batch", () => {
    const r = scoreOutcomes([
      {
        outcome_id: "lo",
        feedbacks: [],
        metrics: [{ name: "open_rate", value: 0.1, direction: "higher_is_better" }],
      },
      {
        outcome_id: "hi",
        feedbacks: [],
        metrics: [{ name: "open_rate", value: 0.9, direction: "higher_is_better" }],
      },
    ]);
    const byId = new Map(r.map((s) => [s.outcome_id, s]));
    expect(byId.get("hi")?.score).toBe(1);
    expect(byId.get("lo")?.score).toBe(0);
  });

  it("flips lower_is_better — smaller is the winner", () => {
    const r = scoreOutcomes([
      {
        outcome_id: "fast",
        feedbacks: [],
        metrics: [{ name: "edit_distance", value: 5, direction: "lower_is_better" }],
      },
      {
        outcome_id: "slow",
        feedbacks: [],
        metrics: [{ name: "edit_distance", value: 50, direction: "lower_is_better" }],
      },
    ]);
    const byId = new Map(r.map((s) => [s.outcome_id, s]));
    expect(byId.get("fast")?.score).toBe(1);
    expect(byId.get("slow")?.score).toBe(0);
  });

  it("ignores 'informational' metrics", () => {
    const r = scoreOutcomes([
      {
        outcome_id: "a",
        feedbacks: [{ rating: 5 }],
        metrics: [
          { name: "char_count", value: 99999, direction: "informational" },
        ],
      },
    ]);
    expect(r[0]?.score).toBe(1); // feedback alone wins
    expect(r[0]?.metric_count).toBe(0);
  });

  it("blends feedback (50%) with normalized metrics (50%)", () => {
    const r = scoreOutcomes([
      {
        outcome_id: "topRating_lowMetric",
        feedbacks: [{ rating: 5 }], // feedback contribution: 1.0
        metrics: [{ name: "x", value: 0, direction: "higher_is_better" }], // normalized: 0
      },
      {
        outcome_id: "lowRating_topMetric",
        feedbacks: [{ rating: 1 }], // feedback: 0
        metrics: [{ name: "x", value: 1, direction: "higher_is_better" }], // normalized: 1
      },
    ]);
    const byId = new Map(r.map((s) => [s.outcome_id, s]));
    // Both end up at 0.5 (one component max, the other min).
    expect(byId.get("topRating_lowMetric")?.score).toBe(0.5);
    expect(byId.get("lowRating_topMetric")?.score).toBe(0.5);
  });

  it("treats a single-value metric as neutral (no spread to normalize against)", () => {
    const r = scoreOutcomes([
      {
        outcome_id: "x",
        feedbacks: [],
        metrics: [{ name: "open_rate", value: 0.42, direction: "higher_is_better" }],
      },
    ]);
    expect(r[0]?.score).toBe(0.5);
  });

  it("clamps every result into [0, 1]", () => {
    const r = scoreOutcomes([
      { outcome_id: "x", feedbacks: [{ rating: 5 }], metrics: [] },
      { outcome_id: "y", feedbacks: [{ rating: 1 }], metrics: [] },
    ]);
    for (const s of r) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });
});
