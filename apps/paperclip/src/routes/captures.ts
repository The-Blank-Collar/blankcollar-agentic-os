/**
 * Captures — the user's natural-language verb.
 *
 * "Remind me to send Mira the contract Friday" → ephemeral goal due Friday.
 * "Every Monday morning, summarise the weekend"  → routine goal w/ cron.
 * "Should I extend the offer to candidate C-019?" → decision goal.
 * "Grow the newsletter to 10k by Q3"             → standing goal with target.
 *
 * The user never types "create a goal." They throw text (or email / voice
 * later) at /api/capture; we classify, persist a capture row, create the
 * resolved entity, and return it. The capture row is the audit trail of
 * "what did you tell me, what did I do with it."
 *
 * v0 classifier is heuristic — fast, deterministic, no API key needed.
 * Phase 5 routes through Hermes for nuanced classification.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { query, tx } from "../db.js";
import { config } from "../config.js";
import { narrate } from "../llm.js";
import { resolveCallerScope } from "../scope.js";
import { CaptureCreate, type GoalKind } from "../schemas.js";

export type Intent = {
  kind: GoalKind;
  title: string;
  description?: string;
  cron_expr?: string;
  due_at?: string;
  target_value?: string;
};

const ROUTINE_RE  = /\b(every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|day|week|morning|evening|hour)|daily|weekly|each\s+(morning|monday|week|day))\b/i;
const DECISION_RE = /\b(should\s+i|approve|yes\s+or\s+no|decide(\s+on)?|confirm|sign[\s-]?off|go\s+ahead\??)\b/i;
const REMIND_RE   = /\b(remind\s+me|follow\s+up|reply\s+to|draft|send|schedule|book)\b/i;
// "to 10k", "to $1.2M", "to 500", "by 30%"
const TARGET_RE   = /\b(to|by|reach|hit)\s+\$?[\d.,kKmMbB%]+/i;
// "by friday", "by Q3", "by 2026-04-30", "next monday"
const DATE_RE     = /\b(by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|q[1-4]|next\s+\w+|\d{4}-\d{2}-\d{2})|next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|quarter))\b/i;

export function classify(raw: string): Intent {
  const text = raw.trim();
  const title = text.length > 200 ? text.slice(0, 197).trimEnd() + "…" : text;

  // Routine — recurring pattern dominates.
  if (ROUTINE_RE.test(text)) {
    const cron = inferCron(text);
    return { kind: "routine", title, cron_expr: cron };
  }
  // Decision — wants a yes/no.
  if (DECISION_RE.test(text)) {
    return { kind: "decision", title };
  }
  // Standing — numeric target + horizon → long-lived objective.
  if (TARGET_RE.test(text) && DATE_RE.test(text)) {
    const targetMatch = text.match(TARGET_RE);
    return {
      kind: "standing",
      title,
      target_value: targetMatch ? targetMatch[0]!.replace(/^(to|by|reach|hit)\s+/i, "") : undefined,
    };
  }
  // Ephemeral — one-off task. Default for anything actionable-sounding.
  void REMIND_RE; // reserved for future weighting
  return { kind: "ephemeral", title };
}

/**
 * LLM-driven classifier — used when ANTHROPIC_API_KEY is set on Paperclip.
 *
 * Returns null on any failure (no key, network error, malformed JSON) so
 * callers always have the heuristic as a safety net. Output shape matches
 * `Intent` exactly.
 */
export async function classifyWithHermes(raw: string): Promise<Intent | null> {
  if (!config.anthropicApiKey) return null;

  const response = await narrate({
    systemHint:
      "You classify natural-language captures into ONE of four kinds:\n" +
      "  ephemeral — a one-off task (reply, follow up, draft, send)\n" +
      "  standing  — a long-lived objective with a numeric target + horizon\n" +
      "  routine   — a recurring task on a schedule\n" +
      "  decision  — a single yes/no awaiting the user\n" +
      "Return ONLY a JSON object on a single line with these keys:\n" +
      '  {"kind":"ephemeral|standing|routine|decision","title":"<short title <= 200 chars>","cron_expr":"<cron string or null>","due_at":"<ISO 8601 or null>","target_value":"<string or null>"}\n' +
      "No prose, no markdown, no code fences. If kind is routine, cron_expr must be set " +
      "in the constrained form 'M H D MON DOW' with M and H as integers or *, D and MON " +
      "as *, DOW as integer 0-6 or *.",
    userPrompt: raw.slice(0, 4_000),
  });
  if (!response) return null;

  // The narrate() helper sometimes returns whole-paragraph LLM output —
  // pull the first JSON object out so a stray header doesn't break parse.
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<Intent> & { kind?: string };
    if (
      parsed.kind === "ephemeral" ||
      parsed.kind === "standing" ||
      parsed.kind === "routine" ||
      parsed.kind === "decision"
    ) {
      const title =
        typeof parsed.title === "string" && parsed.title.length > 0
          ? parsed.title.slice(0, 200)
          : raw.slice(0, 197) + (raw.length > 200 ? "…" : "");
      return {
        kind: parsed.kind,
        title,
        cron_expr: typeof parsed.cron_expr === "string" ? parsed.cron_expr : undefined,
        due_at: typeof parsed.due_at === "string" ? parsed.due_at : undefined,
        target_value: typeof parsed.target_value === "string" ? parsed.target_value : undefined,
      };
    }
  } catch {
    // fall through to null
  }
  return null;
}

function inferCron(text: string): string {
  const t = text.toLowerCase();
  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const dayMatch = t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  const isMorning = /\bmorning\b/.test(t);
  const isEvening = /\bevening\b/.test(t);
  const hour = isMorning ? 8 : isEvening ? 18 : 9;
  if (dayMatch) {
    return `0 ${hour} * * ${dayMap[dayMatch[1]!]}`;
  }
  if (/\bweekly\b|\bevery\s+week\b/.test(t)) return `0 ${hour} * * 1`;
  if (/\bdaily\b|\bevery\s+day\b|\bevery\s+morning\b/.test(t)) return `0 ${hour} * * *`;
  if (/\bevery\s+hour\b/.test(t)) return `0 * * * *`;
  return `0 ${hour} * * *`;
}

export async function captureRoutes(app: FastifyInstance): Promise<void> {
  // -- create -------------------------------------------------------------
  app.post("/api/capture", async (req, reply) => {
    const parsed = CaptureCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    // Try Hermes-grade classification first; fall back to heuristic on any
    // failure so the demo always works offline. Both produce the same Intent
    // shape.
    const llmIntent = await classifyWithHermes(parsed.data.raw_content);
    const intent = llmIntent ?? classify(parsed.data.raw_content);

    const result = await tx(async (client) => {
      // Pass the source through to the goal's metadata so downstream
      // consumers (briefing, inbox) can attribute it to the right channel.
      const goalMetadata = {
        source: "capture",
        capture_source: parsed.data.source,
        ...(parsed.data.metadata ?? {}),
      };

      // Create the downstream goal first so we can link the capture row.
      const { rows: goalRows } = await client.query<{ id: string }>(
        `INSERT INTO ops.goal (
           org_id, title, description, kind, cron_expr, due_at, target_value, metadata
         )
         VALUES ($1, $2, $3, $4::ops.goal_kind, $5, $6, $7, $8::jsonb)
         RETURNING id`,
        [
          scope.org_id,
          intent.title,
          intent.description ?? null,
          intent.kind,
          intent.cron_expr ?? null,
          intent.due_at ?? null,
          intent.target_value ?? null,
          JSON.stringify(goalMetadata),
        ],
      );
      const goalId = goalRows[0]!.id;

      // The parsed_intent column captures both the classifier's output and
      // any provenance metadata the caller passed in (sender, subject,
      // message_id for emails; transcript_id for voice; etc.).
      const parsedIntentRow = {
        ...intent,
        ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {}),
      };
      const { rows: capRows } = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO ops.capture (
           org_id, source, raw_content, parsed_intent, resolved_to_id, resolved_kind
         )
         VALUES ($1, $2::ops.capture_source, $3, $4::jsonb, $5, $6)
         RETURNING id, created_at`,
        [
          scope.org_id,
          parsed.data.source,
          parsed.data.raw_content,
          JSON.stringify(parsedIntentRow),
          goalId,
          "goal",
        ],
      );
      const cap = capRows[0]!;

      await audit(
        {
          scope,
          action: "capture.create",
          target_type: "capture",
          target_id: cap.id,
          metadata: { goal_id: goalId, kind: intent.kind, source: parsed.data.source },
        },
        client,
      );

      return { capture_id: cap.id, goal_id: goalId, intent, created_at: cap.created_at };
    });

    return reply.code(201).send(result);
  });

  // -- recent captures ----------------------------------------------------
  app.get("/api/capture", async (req) => {
    const scope = await resolveCallerScope(req);
    const { rows } = await query(
      `SELECT id, source, raw_content, parsed_intent, resolved_to_id, resolved_kind, created_at
       FROM ops.capture WHERE org_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [scope.org_id],
    );
    return rows;
  });
}
