import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { detectMode, emit, relative } from "../format.js";

type Agent = {
  id: string;
  kind: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

type AgentState = Agent & {
  status: "live" | "idle" | "warn";
  current_activity: string | null;
  sigil_seed: string;
  recent_runs: Array<{ id: string; status: string; created_at: string; goal_title: string | null }>;
};

const STATUS_DOT: Record<AgentState["status"], string> = {
  live: "●",
  idle: "○",
  warn: "▲",
};

export async function runAgentsList(args: ParsedArgs, client: Client): Promise<number> {
  const agents = await client.get<Agent[]>("/api/agents", { is_active: true });
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", agents);
    return 0;
  }
  const lines = [`agents · ${agents.length}`];
  for (const a of agents) {
    lines.push(`  ${a.id.slice(0, 8)} ${a.kind.padEnd(10)} ${a.name}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runAgentGet(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    process.stderr.write("usage: bc agent <id>\n");
    return 2;
  }
  const a = await client.get<AgentState>(`/api/agents/${encodeURIComponent(id)}/state`);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", a);
    return 0;
  }
  const lines = [
    `${STATUS_DOT[a.status]} ${a.name}  (${a.kind})  ${a.id.slice(0, 8)}`,
    `  status: ${a.status}${a.current_activity ? ` — ${a.current_activity}` : ""}`,
    `  sigil: ${a.sigil_seed}`,
  ];
  if (a.recent_runs.length > 0) {
    lines.push("  recent:");
    for (const r of a.recent_runs.slice(0, 5)) {
      lines.push(`    · ${r.status.padEnd(10)} ${(r.goal_title ?? "—").slice(0, 60)}  ${relative(r.created_at)}`);
    }
  }
  emit("pretty", lines.join("\n"));
  return 0;
}
