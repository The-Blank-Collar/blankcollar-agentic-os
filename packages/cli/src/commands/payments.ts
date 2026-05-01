import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagInt, flagString } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type Settings = {
  enabled: boolean;
  kill_switch: boolean;
  default_limit_cents: number;
  default_period: "per_request" | "daily" | "weekly" | "monthly";
  approval_threshold: number;
  notify_email: string | null;
  updated_at: string;
};

type Limit = {
  id: string;
  agent_id: string;
  limit_cents: number;
  period: "per_request" | "daily" | "weekly" | "monthly";
  category: string | null;
  created_at: string;
};

type PaymentRequest = {
  id: string;
  agent_id: string | null;
  amount_cents: number;
  currency: string;
  vendor: string;
  category: string | null;
  description: string;
  status: string;
  approval_id: string | null;
  decided_reason: string | null;
  created_at: string;
};

const STATUS_GLYPH: Record<string, string> = {
  pending:   "?",
  approved:  "✓",
  executing: "▸",
  succeeded: "★",
  failed:    "✗",
  declined:  "✗",
  expired:   "—",
  killed:    "☒",
};

function dollars(cents: number, currency = "USD"): string {
  const v = (cents / 100).toFixed(2);
  if (currency === "USD") return `$${v}`;
  return `${v} ${currency}`;
}

export async function runPaymentsStatus(args: ParsedArgs, client: Client): Promise<number> {
  const s = await client.get<Settings>("/api/payments/settings");
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", s);
    return 0;
  }
  const lines = [
    `payments · ${s.enabled ? "enabled" : "DISABLED"}${s.kill_switch ? " · KILL SWITCH ACTIVE" : ""}`,
    `  default limit:      ${dollars(s.default_limit_cents)} per ${s.default_period}`,
    `  approval threshold: ${s.approval_threshold > 0 ? dollars(s.approval_threshold) : "—"}`,
    `  notify email:       ${s.notify_email ?? "—"}`,
    `  updated:            ${relative(s.updated_at)}`,
  ];
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runPaymentsEnable(args: ParsedArgs, client: Client, enabled: boolean): Promise<number> {
  await client.request<Settings>({ method: "PUT", path: "/api/payments/settings", body: { enabled } });
  return runPaymentsStatus(args, client);
}

export async function runPaymentsConfigure(args: ParsedArgs, client: Client): Promise<number> {
  const body: Record<string, unknown> = {};
  const limit = flagInt(args.flags, "limit", -1);
  const threshold = flagInt(args.flags, "threshold", -1);
  const period = flagString(args.flags, "period", "");
  const email = flagString(args.flags, "email", "");
  if (limit >= 0) body.default_limit_cents = limit;
  if (threshold >= 0) body.approval_threshold = threshold;
  if (period) body.default_period = period;
  if (email) body.notify_email = email;
  if (Object.keys(body).length === 0) {
    process.stderr.write("usage: bc payments configure [--limit=cents --threshold=cents --period=daily|weekly|monthly|per_request --email=...]\n");
    return 2;
  }
  const out = await client.request<Settings>({ method: "PUT", path: "/api/payments/settings", body });
  const mode = detectMode(args.flags);
  if (mode === "json") emit("json", out);
  else emit("pretty", `updated · default limit ${dollars(out.default_limit_cents)} per ${out.default_period}, threshold ${dollars(out.approval_threshold)}`);
  return 0;
}

export async function runPaymentsKill(args: ParsedArgs, client: Client): Promise<number> {
  const verb = args.subcommand;
  const path = verb === "kill" ? "/api/payments/kill" : "/api/payments/resume";
  const reason = args.positional.join(" ").trim() || undefined;
  const out = await client.post<{ active: boolean }>(path, reason ? { reason } : {});
  emit(detectMode(args.flags), `${verb}ed · kill_switch=${out.active}`);
  return 0;
}

export async function runPaymentsLimits(args: ParsedArgs, client: Client): Promise<number> {
  const verb = args.positional[0];
  const sub = { ...args, positional: args.positional.slice(1) };

  if (verb === "add") {
    const agentId = sub.positional[0];
    const cents = flagInt(sub.flags, "limit", -1);
    const period = flagString(sub.flags, "period", "monthly");
    const category = flagString(sub.flags, "category", "");
    if (!agentId || cents < 0) {
      process.stderr.write("usage: bc payments limits add <agent_id> --limit=<cents> [--period=monthly --category=...]\n");
      return 2;
    }
    const body: Record<string, unknown> = { agent_id: agentId, limit_cents: cents, period };
    if (category) body.category = category;
    const out = await client.post<Limit>("/api/payments/limits", body);
    emit(detectMode(sub.flags), `added · ${out.id.slice(0, 8)} ${dollars(out.limit_cents)} per ${out.period}`);
    return 0;
  }
  if (verb === "rm" || verb === "remove") {
    const id = sub.positional[0];
    if (!id) {
      process.stderr.write("usage: bc payments limits rm <limit_id>\n");
      return 2;
    }
    await client.del(`/api/payments/limits/${encodeURIComponent(id)}`);
    emit(detectMode(sub.flags), `removed · ${id.slice(0, 8)}`);
    return 0;
  }

  const rows = await client.get<Limit[]>("/api/payments/limits");
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", rows);
    return 0;
  }
  if (rows.length === 0) {
    emit("pretty", "no per-agent limits set.");
    return 0;
  }
  const lines = [`payments limits · ${rows.length}`];
  for (const r of rows) {
    const cat = r.category ? ` · ${r.category}` : "";
    lines.push(`  ${r.id.slice(0, 8)} agent=${r.agent_id.slice(0, 8)}  ${dollars(r.limit_cents)} per ${r.period}${cat}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runPaymentsRequests(args: ParsedArgs, client: Client): Promise<number> {
  const status = flagString(args.flags, "status", "");
  const limit = flagInt(args.flags, "limit", 30);
  const params: Record<string, string | number | boolean | undefined> = { limit };
  if (status) params.status = status;
  const rows = await client.get<PaymentRequest[]>("/api/payments/requests", params);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", rows);
    return 0;
  }
  if (rows.length === 0) {
    emit("pretty", "no payment requests.");
    return 0;
  }
  const lines = [`payment requests · ${rows.length}${status ? ` (status=${status})` : ""}`];
  for (const r of rows) {
    const reason = r.decided_reason ? `  — ${trunc(r.decided_reason, 60)}` : "";
    lines.push(`  ${STATUS_GLYPH[r.status] ?? "·"} ${r.id.slice(0, 8)} ${r.status.padEnd(10)} ${dollars(r.amount_cents, r.currency).padStart(10)}  ${trunc(r.vendor, 30).padEnd(30)} ${relative(r.created_at)}${reason}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}
