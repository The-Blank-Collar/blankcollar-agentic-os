import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagBool, flagInt } from "../argv.js";
import { detectMode, emit, trunc } from "../format.js";

type SimulatedSubtask = {
  index: number;
  title: string | null;
  skill: string | null;
  side_effects: "read" | "write" | "external" | "unknown";
  outcome: "would-execute" | "would-have-mutated";
  reason: string;
  preview: Record<string, unknown> | null;
};

type SimulationReport = {
  subtask_count: number;
  would_execute: number;
  would_have_mutated: number;
  subtasks: SimulatedSubtask[];
};

/**
 * `bc dispatch <goal_id>`                     — queue every subtask (live)
 * `bc dispatch <goal_id> --subtask=N`         — queue just one subtask (live)
 * `bc dispatch <goal_id> --simulate`          — dry-run every subtask
 * `bc dispatch <goal_id> --subtask=N --simulate` — dry-run one subtask
 */
export async function runDispatch(args: ParsedArgs, client: Client): Promise<number> {
  const goalId = args.positional[0];
  if (!goalId) {
    process.stderr.write(
      "usage: bc dispatch <goal_id> [--subtask=N] [--simulate]\n" +
        "  --simulate: preview which subtasks would run vs. be intercepted; queues no real runs.\n",
    );
    return 2;
  }
  const simulate = flagBool(args.flags, "simulate") || flagBool(args.flags, "dry-run");
  const subtaskIdx = flagInt(args.flags, "subtask", -1);
  const mode = detectMode(args.flags);

  // --subtask=N → /dispatch ; otherwise → /dispatch-all
  let path: string;
  let body: Record<string, unknown>;
  if (subtaskIdx >= 0) {
    path = `/api/goals/${encodeURIComponent(goalId)}/dispatch`;
    body = { subtask_index: subtaskIdx, mode: simulate ? "simulation" : "live" };
  } else {
    path = `/api/goals/${encodeURIComponent(goalId)}/dispatch-all`;
    body = { mode: simulate ? "simulation" : "live" };
  }

  const resp = await client.post<unknown>(path, body);

  if (mode === "json") {
    emit("json", resp);
    return 0;
  }

  // Live dispatch responses
  if (!simulate) {
    const r = resp as { run_id?: string; run_ids?: string[]; queued?: number; status?: string };
    if (r.run_ids) {
      emit("pretty", `dispatched · ${r.queued ?? r.run_ids.length} run(s) queued`);
    } else if (r.run_id) {
      emit("pretty", `dispatched · run ${r.run_id.slice(0, 8)} queued`);
    } else {
      emit("pretty", JSON.stringify(resp));
    }
    return 0;
  }

  // Simulation responses — pretty rendering of the report
  const sim = resp as { mode?: string; report?: SimulationReport };
  const report = sim.report;
  if (!report) {
    emit("pretty", JSON.stringify(resp));
    return 0;
  }
  const lines = [
    `SIMULATED · ${report.subtask_count} subtask${report.subtask_count === 1 ? "" : "s"} · 0 runs queued`,
    `  ${report.would_execute} would execute, ${report.would_have_mutated} intercepted`,
    "",
  ];
  for (const st of report.subtasks) {
    const glyph = st.outcome === "would-execute" ? "✓" : "⚠";
    const skill = st.skill ?? "(no skill)";
    const title = st.title ? trunc(st.title, 50) : "";
    lines.push(`  ${glyph} ${String(st.index).padStart(2)}. ${skill.padEnd(25)} ${title}`);
    lines.push(`       ${st.side_effects.padEnd(8)} — ${st.reason}`);
    if (st.preview && Object.keys(st.preview).length > 0) {
      const preview = trunc(JSON.stringify(st.preview), 80);
      lines.push(`       inputs: ${preview}`);
    }
  }
  if (report.would_have_mutated > 0) {
    lines.push("");
    lines.push("  → To run for real: bc dispatch " + goalId + (subtaskIdx >= 0 ? ` --subtask=${subtaskIdx}` : ""));
  }
  emit("pretty", lines.join("\n"));
  return 0;
}
