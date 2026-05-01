import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagBool, flagInt, flagString } from "../argv.js";
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

type GoalStats = {
  goal_id: string;
  runs_total: number;
  runs_succeeded: number;
  runs_failed: number;
  runs_running: number;
  runs_queued: number;
  avg_duration_ms: number | null;
  last_run_at: string | null;
  last_run_status: string | null;
};

type GoalsSummary = {
  total: number;
  by_kind: { ephemeral: number; standing: number; routine: number; decision: number };
  by_status: {
    draft: number;
    active: number;
    paused: number;
    achieved: number;
    archived: number;
  };
  stalled_count: number;
};

export async function runGoalsList(args: ParsedArgs, client: Client): Promise<number> {
  const mode = detectMode(args.flags);

  if (flagBool(args.flags, "summary")) {
    const sum = await client.get<GoalsSummary>("/api/goals/summary");
    if (mode === "json") {
      emit("json", sum);
      return 0;
    }
    const lines = [
      `goals · ${sum.total} total · ${sum.stalled_count} stalled`,
      "",
      "by kind:",
      `  ephemeral  ${sum.by_kind.ephemeral}`,
      `  standing   ${sum.by_kind.standing}`,
      `  routine    ${sum.by_kind.routine}`,
      `  decision   ${sum.by_kind.decision}`,
      "",
      "by status:",
      `  draft      ${sum.by_status.draft}`,
      `  active     ${sum.by_status.active}`,
      `  paused     ${sum.by_status.paused}`,
      `  achieved   ${sum.by_status.achieved}`,
      `  archived  ${sum.by_status.archived}`,
    ];
    emit("pretty", lines.join("\n"));
    return 0;
  }

  const status = flagString(args.flags, "status", "active");
  const kind = args.flags.kind;
  const stalled = flagBool(args.flags, "stalled") ? flagInt(args.flags, "stalled", 7) : null;
  const goals = await client.get<Goal[]>("/api/goals", {
    status: status === "all" ? undefined : status,
    kind: typeof kind === "string" ? kind : undefined,
    stalled_for_days: stalled ?? undefined,
    limit: 50,
  });
  if (mode === "json") {
    emit("json", goals);
    return 0;
  }
  if (goals.length === 0) {
    const empty = stalled
      ? `nothing stalled for ≥ ${stalled} day${stalled === 1 ? "" : "s"}.`
      : `no goals (status=${status})`;
    emit("pretty", empty);
    return 0;
  }
  const heading = stalled
    ? `goals · ${goals.length} stalled ≥ ${stalled} day${stalled === 1 ? "" : "s"}`
    : `goals · ${goals.length} (status=${status})`;
  const lines = [heading];
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
    process.stderr.write("usage: bc goal <id> [--stats]\n");
    return 2;
  }
  const wantStats = flagBool(args.flags, "stats");
  const [g, stats] = await Promise.all([
    client.get<GoalDetail>(`/api/goals/${encodeURIComponent(id)}`),
    wantStats
      ? client.get<GoalStats>(`/api/goals/${encodeURIComponent(id)}/stats`)
      : Promise.resolve(null),
  ]);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", stats ? { ...g, stats } : g);
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
  if (stats) {
    const dur = stats.avg_duration_ms != null ? `${(stats.avg_duration_ms / 1000).toFixed(1)}s` : "—";
    const last = stats.last_run_at
      ? `${stats.last_run_status ?? "?"} ${relative(stats.last_run_at)}`
      : "never";
    lines.push("", "stats:");
    lines.push(`  runs:    ${stats.runs_total} total · ${stats.runs_succeeded} succeeded · ${stats.runs_failed} failed`);
    if (stats.runs_running > 0 || stats.runs_queued > 0) {
      lines.push(`  active:  ${stats.runs_running} running · ${stats.runs_queued} queued`);
    }
    lines.push(`  avg:     ${dur}`);
    lines.push(`  last:    ${last}`);
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
