/**
 * Derive auto-config from the interview answers.
 *
 * v0 is heuristic, the same way the capture classifier is heuristic — fast,
 * deterministic, no API key needed. Phase 5 routes the answers through
 * Hermes for nuanced extraction. The shape of `derived` doesn't change.
 *
 * For each answer, we extract:
 *   - voice_words   — three adjectives from Q7/C7
 *   - banned_words  — comma-list from C7 if present
 *   - briefing_hour — UTC integer from Q6 ("8am" → 8)
 *   - channels      — referenced channels from Q3/C4 (slack, email, …)
 *   - routines      — verbs of recurring work from Q4/C3
 *   - decisions     — categories the user wants surfaced from Q5/C5
 *   - departments   — names mentioned in C2 (multi-user only)
 */

const VOICE_WORDS_RE = /\b(plain|warm|dry|precise|playful|blunt|sharp|kind|crisp|formal|casual|bold|gentle|witty|honest|direct|caring|technical)\b/gi;
const CHANNEL_RE = /\b(slack|email|gmail|whatsapp|telegram|discord|teams|zoom|notion|linear|github|stripe|hubspot|salesforce|google\s+(?:calendar|drive|docs|sheets))\b/gi;
const HOUR_RE = /\b(\d{1,2})\s*(am|pm)?\b/i;
const ROUTINE_VERBS_RE = /\b(weekly|every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|day|morning|evening|week)|monthly|quarterly|review|recap|digest|payroll|newsletter|retro)\b/gi;
const DEPT_RE = /\b(marketing|sales|support|finance|engineering|design|operations|legal|hr|product|growth)\b/gi;

export type Derived = {
  voice_words: string[];
  banned_words: string[];
  briefing_hour_utc?: number;
  channels: string[];
  routine_hints: string[];
  decision_categories: string[];
  departments: string[];
  raw_signal: Record<string, string>;
};

type Answer = { question_id: string; answer: string };

function uniqueLower(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.toLowerCase())));
}

function asLocalHour(text: string): number | undefined {
  const match = text.match(HOUR_RE);
  if (!match) return undefined;
  let h = Number(match[1]);
  if (Number.isNaN(h) || h < 0 || h > 24) return undefined;
  if (match[2]?.toLowerCase() === "pm" && h < 12) h += 12;
  if (match[2]?.toLowerCase() === "am" && h === 12) h = 0;
  return h;
}

export function deriveFromAnswers(
  answers: Answer[],
  mode: "single_user" | "multi_user",
): Derived {
  const byId = Object.fromEntries(answers.map((a) => [a.question_id, a.answer.trim()]));

  const voiceSource = byId.Q7 ?? byId.C7 ?? "";
  const voice_words = uniqueLower(voiceSource.match(VOICE_WORDS_RE) ?? []).slice(0, 3);

  // Banned-word list is only asked in C7 ("three words + a banned-words list").
  const bannedMatch = byId.C7?.match(/banned[\s-]+words?\s*[:=]\s*([^\n.]+)/i);
  const banned_words = bannedMatch
    ? uniqueLower(
        bannedMatch[1]!
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : [];

  const channelSource = `${byId.Q3 ?? ""} ${byId.C4 ?? ""} ${byId.I2 ?? ""}`;
  const channels = uniqueLower(channelSource.match(CHANNEL_RE) ?? []);

  const routineSource = `${byId.Q4 ?? ""} ${byId.C3 ?? ""}`;
  const routine_hints = uniqueLower(routineSource.match(ROUTINE_VERBS_RE) ?? []);

  const decisionSource = `${byId.Q5 ?? ""} ${byId.C5 ?? ""}`;
  const decision_categories = uniqueLower(
    decisionSource
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 3 && s.length <= 60),
  ).slice(0, 8);

  const briefing_hour_utc = asLocalHour(byId.Q6 ?? "");

  const departments =
    mode === "multi_user"
      ? uniqueLower(byId.C2?.match(DEPT_RE) ?? []).slice(0, 12)
      : [];

  return {
    voice_words,
    banned_words,
    briefing_hour_utc,
    channels,
    routine_hints,
    decision_categories,
    departments,
    raw_signal: byId,
  };
}
