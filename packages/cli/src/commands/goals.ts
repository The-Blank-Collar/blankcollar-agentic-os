import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagString } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type Goal = {
  id: string;
  title: string;
  kind: string;
  status: string;
  due_at: string | null;
  progress: string | null;
  cron_expr: string | null;
  updated_at: string;
};

type GoalDetail = Goal & {
  description: string | null;
  target_value: string | null;
  actual_value: string | null;
  key_results?: Array<{ id: string; label: string; target_value: string | null; current_value: string | null }>;
  contributors?: Array<{ agent_id: string | null; user_id: string | null }>;
};

export async function runGoalsList(args: ParsedArgs, client: Client): Promise<number> {
  const status = flagString(args.flags, "status", "active");
  const kind = args.flags.kind;
  const goals = await client.get<Goal[]>("/api/goals", {
    status: status === "all" ? undefined : status,
    kind: typeof kind === "string" ? kind : undefined,
    limit: 50,
  });
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", goals);
    return 0;
  }
  if (goals.length === 0) {
    emit("pretty", `no goals (status=${status})`);
    return 0;
  }
  const lines = [`goals · ${goals.length} (status=${status})`];
  for (const g of goals) {
    const tag =
      g.kind === "routine" && g.cron_expr
        ? `routine ${g.cron_expr}`
        : g.kind === "decision"
          ? "decision"
          : g.kind === "standing"
            ? "standing"
            : "ephemeral";
    const due = g.due_at ? `· due ${new Date(g.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "";
    lines.push(
      `  ${g.id.slice(0, 8)} ${tag.padEnd(18)} ${trunc(g.title, 70)}  ${due ? due : relative(g.updated_at)}`,
    );
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runGoalGet(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    process.stderr.write("usage: bc goal <id>\n");
    return 2;
  }
  const g = await client.get<GoalDetail>(`/api/goals/${encodeURIComponent(id)}`);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", g);
    return 0;
  }
  const lines = [
    `${g.id}  ${g.kind}  ${g.status}`,
    g.title,
    "",
    g.description ?? "",
  ];
  if (g.key_results && g.key_results.length > 0) {
    lines.push("key results:");
    for (const kr of g.key_results) {
      const progress = kr.target_value ? `${kr.current_value ?? "—"} / ${kr.target_value}` : "(no target)";
      lines.push(`  · ${kr.label}  [${progress}]`);
    }
  }
  if (g.contributors && g.contributors.length > 0) {
    const ids = g.contributors
      .map((c) => (c.agent_id ?? c.user_id ?? "—").slice(0, 8))
      .join(", ");
    lines.push("", `contributors: ${ids}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runGoalResolve(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  const resolution = args.subcommand === "approve" ? "approved" : "declined";
  const note = args.positional.slice(1).join(" ").trim() || undefined;
  if (!id) {
    process.stderr.write(`usage: bc ${args.subcommand} <id> [note]\n`);
    return 2;
  }
  const out = await client.post<{ id: string; status: string }>(
    `/api/goals/${encodeURIComponent(id)}/resolve`,
    { resolution, note },
  );
  emit(detectMode(args.flags), `${resolution}: ${out.id} (status=${out.status})`);
  return 0;
}
