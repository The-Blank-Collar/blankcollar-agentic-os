import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagInt } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type ActivityRow = {
  run_id: string;
  goal_id: string;
  goal_title: string;
  goal_kind: string;
  agent_id: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  duration_ms: number | null;
  subtask_title: string | null;
};

const STATUS_ICON: Record<string, string> = {
  queued: "·",
  running: "▸",
  succeeded: "✓",
  failed: "✗",
  cancelled: "—",
};

export async function runTail(args: ParsedArgs, client: Client): Promise<number> {
  const limit = flagInt(args.flags, "limit", 20);
  const rows = await client.get<ActivityRow[]>("/api/activity", { limit });
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", rows);
    return 0;
  }
  if (rows.length === 0) {
    emit("pretty", "no recent activity.");
    return 0;
  }
  const lines = [`activity · ${rows.length} most recent`];
  for (const r of rows) {
    const icon = STATUS_ICON[r.status] ?? "·";
    const dur = r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—";
    const sub = r.subtask_title ? ` · ${trunc(r.subtask_title, 40)}` : "";
    lines.push(
      `  ${icon} ${r.run_id.slice(0, 8)} ${r.status.padEnd(10)} ${trunc(r.goal_title, 50)}${sub}  ${dur}  ${relative(r.created_at)}`,
    );
  }
  emit("pretty", lines.join("\n"));
  return 0;
}
