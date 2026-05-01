import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagString } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type CronField = number | "*";

/**
 * Constrained cron parser — same grammar as Paperclip's scheduler.parseCron,
 * duplicated here so the CLI doesn't have to import the server module.
 *   M H * * DOW    where M, H, DOW are an integer or "*"
 */
function parseCron(expr: string): { minute: CronField; hour: CronField; dow: CronField } | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, d, mon, dow] = parts as [string, string, string, string, string];
  if (d !== "*" || mon !== "*") return null;
  const f = (raw: string, lo: number, hi: number): CronField | null => {
    if (raw === "*") return "*";
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return n >= lo && n <= hi ? n : null;
  };
  const minute = f(m, 0, 59);
  const hour = f(h, 0, 23);
  const dwk = f(dow, 0, 6);
  if (minute === null || hour === null || dwk === null) return null;
  return { minute, hour, dow: dwk };
}

/** Walks forward minute by minute (up to 1 week) for the next firing instant. */
export function nextCronFire(expr: string, from: Date = new Date()): Date | null {
  const cron = parseCron(expr);
  if (!cron) return null;
  const t = new Date(from);
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  const limit = new Date(t.getTime() + 7 * 24 * 60 * 60_000);
  while (t.getTime() <= limit.getTime()) {
    if (
      (cron.minute === "*" || cron.minute === t.getUTCMinutes()) &&
      (cron.hour === "*" || cron.hour === t.getUTCHours()) &&
      (cron.dow === "*" || cron.dow === t.getUTCDay())
    ) {
      return t;
    }
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return null;
}

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
    const next = g.cron_expr ? nextCronFire(g.cron_expr) : null;
    const nextLabel = next ? `next ${relative(next.toISOString())}` : `updated ${relative(g.updated_at)}`;
    lines.push(`  ${g.id.slice(0, 8)} ${cron.padEnd(18)} ${trunc(g.title, 50).padEnd(50)} ${nextLabel}`);
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
