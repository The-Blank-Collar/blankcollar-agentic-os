import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagString } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type Goal = {
  id: string;
  title: string;
  kind: string;
  status: string;
  cron_expr: string | null;
  updated_at: string;
};

type Trigger = {
  id: string;
  goal_id: string;
  trigger_kind: "schedule" | "event" | "api";
  trigger_spec: Record<string, unknown>;
  enabled: boolean;
  last_fired_at: string | null;
  created_at: string;
};

const TRIGGER_GLYPH: Record<Trigger["trigger_kind"], string> = {
  schedule: "⏱",
  event: "⚡",
  api: "↗",
};

export async function runRoutinesList(args: ParsedArgs, client: Client): Promise<number> {
  const goals = await client.get<Goal[]>("/api/goals", { kind: "routine", status: "active", limit: 100 });
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", goals);
    return 0;
  }
  if (goals.length === 0) {
    emit("pretty", "no active routines.");
    return 0;
  }
  const lines = [`routines · ${goals.length}`];
  for (const g of goals) {
    const cron = g.cron_expr ? `cron ${g.cron_expr}` : "(no cron)";
    lines.push(`  ${g.id.slice(0, 8)} ${cron.padEnd(18)} ${trunc(g.title, 60)}  updated ${relative(g.updated_at)}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runTriggersList(args: ParsedArgs, client: Client): Promise<number> {
  const goalId = args.positional[0];
  if (!goalId) {
    process.stderr.write("usage: bc triggers <goal_id>\n");
    return 2;
  }
  const triggers = await client.get<Trigger[]>(`/api/goals/${encodeURIComponent(goalId)}/triggers`);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", triggers);
    return 0;
  }
  if (triggers.length === 0) {
    emit("pretty", "no triggers on this goal.");
    return 0;
  }
  const lines = [`triggers · ${triggers.length}`];
  for (const t of triggers) {
    const glyph = TRIGGER_GLYPH[t.trigger_kind] ?? "·";
    const enabled = t.enabled ? "" : " (disabled)";
    const last = t.last_fired_at ? `last ${relative(t.last_fired_at)}` : "never fired";
    const detail =
      t.trigger_kind === "schedule"
        ? String(t.trigger_spec.cron_expr ?? "")
        : t.trigger_kind === "event"
          ? `on ${String(t.trigger_spec.action ?? "")}`
          : "api token";
    lines.push(`  ${glyph} ${t.id.slice(0, 8)} ${t.trigger_kind.padEnd(8)} ${detail.padEnd(20)} ${last}${enabled}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runTriggerFire(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    process.stderr.write("usage: bc fire <trigger_id> [--token=<token>]\n");
    return 2;
  }
  const token = flagString(args.flags, "token", "");
  const out = await client.post<{ fired: boolean; run_count: number }>(
    `/api/routines/triggers/${encodeURIComponent(id)}/fire`,
    token ? { token } : {},
  );
  emit(detectMode(args.flags), `fired · ${out.run_count} run(s) queued`);
  return 0;
}
