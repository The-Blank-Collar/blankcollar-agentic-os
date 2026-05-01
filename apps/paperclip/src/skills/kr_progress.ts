/**
 * KR completion detection.
 *
 * Compares a key result's current_value to its target_value and decides
 * whether the KR is "achieved." Heuristic — values are free-form strings
 * because users phrase goals naturally ("$1.2M ARR", "10k subscribers").
 *
 * Comparison rules (in order):
 *   1. If both parse as numbers (after stripping $ , % k m b suffixes),
 *      compare numerically.
 *   2. Otherwise, lower-cased equality.
 *
 * Returns:
 *   - "achieved"   — current_value met or exceeded target_value
 *   - "in_progress"  — current parses as a number, target parses as a number,
 *                    current is below target
 *   - "unknown"    — couldn't compare; UI shows "(no target)" anyway
 */

const SUFFIX_K = 1_000;
const SUFFIX_M = 1_000_000;
const SUFFIX_B = 1_000_000_000;

export type KrStatus = "achieved" | "in_progress" | "unknown";

/** Parse a free-form numeric string ("$1.2M", "10k", "30%") to a number. */
export function parseNumeric(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  // Strip currency / formatting; preserve digits, dot, sign, k/m/b/% suffix.
  const cleaned = trimmed.replace(/[$\s,]/g, "");
  const m = cleaned.match(/^(-?[\d.]+)([kmb%]?)$/);
  if (!m) return null;
  const base = Number.parseFloat(m[1]!);
  if (Number.isNaN(base)) return null;
  switch (m[2]) {
    case "k":
      return base * SUFFIX_K;
    case "m":
      return base * SUFFIX_M;
    case "b":
      return base * SUFFIX_B;
    case "%":
      return base; // percentages compare as-is
    default:
      return base;
  }
}

export function computeKrStatus(
  currentValue: string | null | undefined,
  targetValue: string | null | undefined,
): KrStatus {
  if (!targetValue) return "unknown";
  if (!currentValue) return "in_progress";

  const currentNum = parseNumeric(currentValue);
  const targetNum = parseNumeric(targetValue);

  if (currentNum !== null && targetNum !== null) {
    return currentNum >= targetNum ? "achieved" : "in_progress";
  }

  // Fall back to case-insensitive equality.
  if (currentValue.trim().toLowerCase() === targetValue.trim().toLowerCase()) {
    return "achieved";
  }

  return "in_progress";
}

/**
 * Returns the parent goal's progress percentage (0–100) given a list of
 * KRs. Each KR contributes its individual achievement % weighted by `weight`.
 * Numeric KRs use min(current/target, 1); non-numeric KRs are 1 if achieved
 * and 0 otherwise.
 */
export function rollupProgress(
  krs: Array<{
    current_value: string | null;
    target_value: string | null;
    weight: number | string;
  }>,
): number {
  if (krs.length === 0) return 0;
  let totalWeight = 0;
  let weightedSum = 0;
  for (const kr of krs) {
    const w = typeof kr.weight === "string" ? Number.parseFloat(kr.weight) : kr.weight;
    const weight = Number.isFinite(w) && w > 0 ? w : 1;
    totalWeight += weight;

    const cur = parseNumeric(kr.current_value);
    const tgt = parseNumeric(kr.target_value);
    if (cur !== null && tgt !== null && tgt !== 0) {
      const ratio = Math.max(0, Math.min(cur / tgt, 1));
      weightedSum += weight * ratio;
    } else {
      weightedSum += weight * (computeKrStatus(kr.current_value, kr.target_value) === "achieved" ? 1 : 0);
    }
  }
  if (totalWeight === 0) return 0;
  return Math.round((weightedSum / totalWeight) * 100);
}
