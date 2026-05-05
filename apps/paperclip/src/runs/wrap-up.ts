/**
 * Run wrap-up (Phase 9.2).
 *
 * Hermes already records its successful runs as `episode` memories
 * inside its own runner (apps/hermes/app/runner.py). What was missing:
 *
 *   - Non-Hermes successes (OpenClaw, future agent kinds) — never wrote.
 *   - ANY failure — error text disappeared from agent recall, so the
 *     next run repeated the same mistake.
 *
 * This module adds a single entry point — `recordRunWrapUp()` — called
 * from the worker's terminal hooks (succeed / fail / cancelLocal).
 * Lean by design:
 *
 *   - Zero LLM calls. We extract a narrative from the run's existing
 *     output (or error). The agent already produced prose; we just
 *     condense + persist it.
 *   - Zero new tables. Writes to brain.memory (kind=episode for ok,
 *     kind=fact for failures so they're picked up by recall but
 *     marked distinctly via metadata.run_status).
 *   - Skip when Hermes already wrote a memory_id (no double-recording).
 *
 * Best-effort everywhere — wrap-up failures must not roll back a real
 * run. The caller wraps each call in try/catch with a swallowed error.
 */

import type pg from "pg";

type WrapUpKind = "succeeded" | "failed" | "cancelled";

const HEAD_CHARS = 600;   // narrative excerpt cap — keep memory recall blocks readable
const TITLE_CHARS = 120;

/**
 * Compose + insert a wrap-up memory inside the caller's transaction.
 *
 * Idempotency: brain.memory has no unique constraint we can lean on,
 * so we don't try to dedupe — the worker's succeed/fail paths fire
 * exactly once per terminal transition, which is good enough.
 *
 * Caller must already be inside `withOrgScope(goal.org_id, …)`.
 */
export async function recordRunWrapUp(
  client: pg.PoolClient,
  args: {
    runId: string;
    goalId: string;
    goalTitle: string;
    departmentId: string | null;
    agentKind: string | null;
    status: WrapUpKind;
    output: Record<string, unknown> | null;
    error: string | null;
  },
): Promise<void> {
  // Hermes successes already recorded — skip to avoid double-writes.
  // The runner stamps `output.memory_id` whenever it called brain.remember.
  if (
    args.status === "succeeded" &&
    args.output &&
    typeof (args.output as { memory_id?: unknown }).memory_id === "string"
  ) {
    return;
  }

  const narrative = pickNarrative(args.status, args.output, args.error);
  if (!narrative) return; // nothing meaningful to record

  const title = composeTitle(args.status, args.goalTitle, args.agentKind);
  const kind = args.status === "succeeded" ? "episode" : "fact";

  await client.query(
    `INSERT INTO brain.memory
       (org_id, department_id, goal_id, kind, title, content, metadata)
     VALUES (
       current_setting('app.org_id', true)::uuid,
       $1, $2, $3::brain.memory_kind, $4, $5, $6::jsonb
     )`,
    [
      args.departmentId,
      args.goalId,
      kind,
      title,
      narrative,
      JSON.stringify({
        source: "run_wrap_up",
        run_id: args.runId,
        run_status: args.status,
        agent_kind: args.agentKind ?? "unknown",
      }),
    ],
  );
}

function composeTitle(status: WrapUpKind, goalTitle: string, agentKind: string | null): string {
  const tag = status === "succeeded" ? "Run" : status === "cancelled" ? "Cancelled run" : "Run failed";
  const who = agentKind ? ` (${agentKind})` : "";
  const head = goalTitle.length > TITLE_CHARS - 30
    ? goalTitle.slice(0, TITLE_CHARS - 33) + "…"
    : goalTitle;
  return `${tag}${who} · ${head}`.slice(0, TITLE_CHARS);
}

function pickNarrative(
  status: WrapUpKind,
  output: Record<string, unknown> | null,
  error: string | null,
): string | null {
  if (status !== "succeeded") {
    if (!error) return null;
    return clamp(`Failure: ${error}`);
  }
  if (!output) return null;
  // Common output shapes we've seen in this codebase:
  //   - Hermes:  { summary, agent_kind, memory_id, model, memories_used }
  //   - OpenClaw: { result?, output?, text?, summary? }
  //   - Tool/skill calls: { result?, content?, output? }
  // Pick the longest stringy field — the model already wrote prose;
  // we don't need to re-summarise it.
  const candidates = [
    (output as { summary?: unknown }).summary,
    (output as { result?: unknown }).result,
    (output as { output?: unknown }).output,
    (output as { content?: unknown }).content,
    (output as { text?: unknown }).text,
    (output as { message?: unknown }).message,
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.length - a.length);
  return clamp(candidates[0]!);
}

function clamp(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length <= HEAD_CHARS) return trimmed;
  return trimmed.slice(0, HEAD_CHARS - 1) + "…";
}
