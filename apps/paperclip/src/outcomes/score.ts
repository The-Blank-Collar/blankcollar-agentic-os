/**
 * Outcome scoring — turn a row of metrics + feedback into a single 0..1
 * "how successful was this output" number that the retriever can use to
 * rank candidates for few-shot injection.
 *
 * Inputs:
 *   - feedback rating (1..5) from `ops.run_feedback` — Sprint 2.3.
 *     Mapped 1→0.0 / 2→0.25 / 3→0.5 / 4→0.75 / 5→1.0.
 *   - per-metric values from `ops.outcome_metric`. Each metric carries a
 *     `direction` flag — higher_is_better / lower_is_better /
 *     informational. Informational metrics are skipped.
 *
 * The composite is a simple weighted average:
 *   - feedback weighs 0.5 (humans are the ground truth)
 *   - every non-informational metric shares the remaining 0.5 equally
 *
 * Per-metric normalization: we don't know the absolute "good" value of
 * a domain metric (open rate vs. conversion vs. NPS), so we normalize
 * within the candidate set passed to the retriever — the highest value
 * for `higher_is_better` (or lowest for `lower_is_better`) maps to 1.0,
 * the rest scale linearly. This keeps the score self-relative and avoids
 * needing per-metric tuning.
 */

export type FeedbackInput = {
  rating: number; // 1..5
};

export type MetricInput = {
  name: string;
  value: number;
  direction: "higher_is_better" | "lower_is_better" | "informational";
};

export type OutcomeForScoring = {
  outcome_id: string;
  feedbacks: FeedbackInput[];
  metrics: MetricInput[];
};

export type ScoredOutcome = {
  outcome_id: string;
  score: number; // 0..1
  has_feedback: boolean;
  metric_count: number;
};

/**
 * Score a batch of candidates relative to each other. The same metric
 * across the batch is min-max normalized; missing metrics on a candidate
 * count as 0 for that metric.
 *
 * Empty `candidates` → empty result.
 * A candidate with no feedback + no metrics gets a baseline 0.5 (we
 * don't know it's good or bad).
 */
export function scoreOutcomes(candidates: OutcomeForScoring[]): ScoredOutcome[] {
  if (candidates.length === 0) return [];

  // Collect metric ranges across the batch.
  type Range = { min: number; max: number; direction: MetricInput["direction"] };
  const ranges = new Map<string, Range>();
  for (const c of candidates) {
    for (const m of c.metrics) {
      if (m.direction === "informational") continue;
      const r = ranges.get(m.name);
      if (!r) {
        ranges.set(m.name, { min: m.value, max: m.value, direction: m.direction });
      } else {
        if (m.value < r.min) r.min = m.value;
        if (m.value > r.max) r.max = m.value;
      }
    }
  }

  return candidates.map((c) => {
    const rating = averageRating(c.feedbacks);
    const fbScore = rating === null ? null : (rating - 1) / 4;

    const metricScores: number[] = [];
    for (const m of c.metrics) {
      if (m.direction === "informational") continue;
      const r = ranges.get(m.name);
      if (!r) continue;
      if (r.max === r.min) {
        metricScores.push(0.5); // single-value metric — neutral
        continue;
      }
      const norm = (m.value - r.min) / (r.max - r.min);
      metricScores.push(m.direction === "higher_is_better" ? norm : 1 - norm);
    }
    const metricAvg = metricScores.length === 0
      ? null
      : metricScores.reduce((a, b) => a + b, 0) / metricScores.length;

    let score: number;
    if (fbScore !== null && metricAvg !== null) {
      score = 0.5 * fbScore + 0.5 * metricAvg;
    } else if (fbScore !== null) {
      score = fbScore;
    } else if (metricAvg !== null) {
      score = metricAvg;
    } else {
      score = 0.5; // unknown — neutral
    }
    return {
      outcome_id: c.outcome_id,
      score: clamp(score, 0, 1),
      has_feedback: c.feedbacks.length > 0,
      metric_count: c.metrics.filter((m) => m.direction !== "informational").length,
    };
  });
}

function averageRating(fbs: FeedbackInput[]): number | null {
  if (fbs.length === 0) return null;
  const sum = fbs.reduce((a, b) => a + b.rating, 0);
  return sum / fbs.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
