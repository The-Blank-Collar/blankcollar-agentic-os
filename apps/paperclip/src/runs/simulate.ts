/**
 * Simulation helper for goal dispatch (Phase 2.3.b).
 *
 * Given a goal's plan (a list of subtasks), classify each subtask as
 * "would execute" or "would have been side-effecting" based on the
 * skill manifest's `side_effects` field. No real runs are queued.
 *
 * Decision table:
 *   side_effects='read'      → would-execute (information only)
 *   side_effects='write'     → would-have-mutated (skipped)
 *   side_effects='external'  → would-have-mutated (skipped)
 *   no skill matched / null  → would-have-mutated (default-deny — safer
 *                              to refuse than execute something we can't
 *                              classify)
 */

import type pg from "pg";

export type Subtask = {
  index?: number;
  title?: string;
  skill?: string | null;
  agent_kind?: string | null;
  input?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
};

export type SimulatedSubtask = {
  index: number;
  title: string | null;
  skill: string | null;
  side_effects: "read" | "write" | "external" | "unknown";
  /** "would-execute" | "would-have-mutated" — the operator-facing verb. */
  outcome: "would-execute" | "would-have-mutated";
  reason: string;
  preview: Record<string, unknown> | null;
};

export type SimulationReport = {
  subtask_count: number;
  would_execute: number;
  would_have_mutated: number;
  subtasks: SimulatedSubtask[];
};

export async function simulateDispatch(
  client: pg.PoolClient,
  orgId: string,
  subtasks: unknown[],
): Promise<SimulationReport> {
  const out: SimulatedSubtask[] = [];
  let exec = 0;
  let mutated = 0;

  for (let i = 0; i < subtasks.length; i++) {
    const raw = subtasks[i] as Subtask | null;
    const skillSlug =
      typeof raw?.skill === "string" && raw.skill.length > 0 ? raw.skill : null;
    const title = typeof raw?.title === "string" ? raw.title : null;
    const inputs =
      (raw?.inputs as Record<string, unknown> | undefined) ??
      (raw?.input as Record<string, unknown> | undefined) ??
      null;

    let sideEffects: SimulatedSubtask["side_effects"] = "unknown";
    if (skillSlug) {
      const { rows } = await client.query<{ side_effects: string }>(
        `SELECT side_effects FROM ops.skill
          WHERE slug = $1
            AND (org_id IS NULL OR org_id = $2)
            AND enabled = true
          ORDER BY version DESC LIMIT 1`,
        [skillSlug, orgId],
      );
      if (rows.length > 0) {
        const se = rows[0]!.side_effects;
        if (se === "read" || se === "write" || se === "external") sideEffects = se;
      }
    }

    let outcome: SimulatedSubtask["outcome"];
    let reason: string;
    if (sideEffects === "read") {
      outcome = "would-execute";
      reason = "read-only — would execute against real APIs";
      exec++;
    } else if (sideEffects === "write" || sideEffects === "external") {
      outcome = "would-have-mutated";
      reason =
        sideEffects === "external"
          ? "external side-effect — intercepted (no real call)"
          : "mutating — intercepted (no real change)";
      mutated++;
    } else {
      // No skill, or skill not found, or unknown side_effects value:
      // safer to refuse in simulation than risk executing something
      // we can't classify.
      outcome = "would-have-mutated";
      reason = skillSlug
        ? `skill '${skillSlug}' not in registry — refused (default-deny)`
        : "no skill declared — refused (default-deny)";
      mutated++;
    }

    out.push({
      index: typeof raw?.index === "number" ? raw.index : i,
      title,
      skill: skillSlug,
      side_effects: sideEffects,
      outcome,
      reason,
      preview: inputs,
    });
  }

  return {
    subtask_count: out.length,
    would_execute: exec,
    would_have_mutated: mutated,
    subtasks: out,
  };
}
