/**
 * Safeguards parser — turns plain-English markdown rules into ops.policy
 * candidates. Forgiving of formatting; favours sensible defaults so the
 * operator can write naturally and refine in the UI.
 *
 * Supported shapes (one rule per line / bullet):
 *
 *   - Never send outbound email without approval.
 *   - Never extend an offer above band. (skill: hire.extend_offer, effect: deny)
 *   - Never spend more than $200 in one transaction. (effect: approve)
 *   - Always review press releases before they go out. (skill: press.send)
 *   - Auto-approve invoices under $500. (effect: allow, skill: payment.charge)
 *
 * Annotations live in `( ... )` at the end of the line and are
 * comma-separated `key: value` pairs. Recognised keys:
 *   - skill         → policy.skill_slug
 *   - skill_slug    → policy.skill_slug (alias)
 *   - agent_kind    → policy.agent_kind
 *   - action_kind   → policy.action_kind
 *   - effect        → 'allow' | 'approve' | 'deny'
 *   - reason        → policy.reason (overrides the textual line)
 *
 * Effect inference (when no explicit `effect:`):
 *   - line starts with "never" + contains "without approval" / "approval needed" → approve
 *   - line starts with "never" → deny
 *   - line contains "auto-approve" / "auto approve" → allow
 *   - line contains "always review" / "approval required" / "needs approval" → approve
 *   - default → approve  (safer than allow)
 *
 * The parser never throws; every malformed line surfaces as a `warnings[]`
 * entry the UI can display. Lines that are blank, headings (`#`), or
 * comments (`//`) are silently skipped.
 */

import { createHash } from "node:crypto";

import type { PolicyEffect } from "../policy/evaluate.js";

export type ParsedRule = {
  effect: PolicyEffect;
  agent_kind: string | null;
  skill_slug: string | null;
  action_kind: string | null;
  reason: string;
  priority: number;
};

export type ParseWarning = {
  line: string;
  line_number: number;
  message: string;
};

export type ParseResult = {
  rules: ParsedRule[];
  warnings: ParseWarning[];
};

const SAFEGUARD_PRIORITY = 50;

export function parseSafeguards(md: string): ParseResult {
  const rules: ParsedRule[] = [];
  const warnings: ParseWarning[] = [];

  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    // Strip a bullet marker (`-`, `*`, `+`) or numbered list prefix.
    const text = trimmed
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .trim();
    if (!text) continue;

    // Split off the trailing annotation block, if any.
    const annoMatch = text.match(/\s*\(([^()]+)\)\s*\.?\s*$/);
    const body = annoMatch ? text.slice(0, annoMatch.index!).trim() : text;
    const anno = annoMatch ? parseAnnotation(annoMatch[1]!) : {};

    let effect: PolicyEffect | null = null;
    if (anno.effect) {
      const e = anno.effect.toLowerCase();
      if (e === "allow" || e === "approve" || e === "deny") {
        effect = e;
      } else {
        warnings.push({
          line: text,
          line_number: i + 1,
          message: `Unknown effect "${anno.effect}". Use allow / approve / deny.`,
        });
      }
    }
    if (effect === null) effect = inferEffect(body.toLowerCase());

    rules.push({
      effect,
      agent_kind: trimToNull(anno.agent_kind ?? null),
      skill_slug: trimToNull(anno.skill ?? anno.skill_slug ?? null),
      action_kind: trimToNull(anno.action_kind ?? null),
      reason: trimToBlank(anno.reason) || stripTrailingPeriod(body),
      priority: SAFEGUARD_PRIORITY,
    });
  }

  return { rules, warnings };
}

function inferEffect(lower: string): PolicyEffect {
  // "Never X without approval" / "needs approval" — caller wants the action
  // gated, not blocked outright.
  if (
    /\bnever\b.*\b(without\s+approval|approval\s+(?:required|needed)|needs?\s+approval|require[ds]?\s+approval)\b/.test(lower)
  ) {
    return "approve";
  }
  if (/\bnever\b/.test(lower)) {
    return "deny";
  }
  if (/\bauto[-\s]?approve\b/.test(lower)) {
    return "allow";
  }
  if (
    /\b(always\s+review|approval\s+(?:required|needed)|needs?\s+approval|require[ds]?\s+approval|reviewed\s+by)\b/.test(lower)
  ) {
    return "approve";
  }
  // Default: approve. Safer to bother the operator than silently let through.
  return "approve";
}

function parseAnnotation(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(",")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const val = part.slice(idx + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}

function trimToNull(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

function trimToBlank(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim();
}

function stripTrailingPeriod(s: string): string {
  return s.replace(/\.\s*$/, "");
}

export function hashSafeguards(md: string): string {
  return createHash("sha256").update(md).digest("hex");
}
