import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagBool } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type Approval = {
  id: string;
  goal_id: string | null;
  run_id: string | null;
  action_kind: string;
  reason: string | null;
  urgency: "low" | "normal" | "urgent";
  resolution: "approved" | "declined" | "expired" | null;
  created_at: string;
};

type ApprovalSummary = {
  pending: { total: number; urgent: number; normal: number; low: number };
  recent:  { approved_7d: number; declined_7d: number; expired_7d: number };
};

export async function runApprovalsList(args: ParsedArgs, client: Client): Promise<number> {
  const mode = detectMode(args.flags);

  if (flagBool(args.flags, "summary")) {
    const sum = await client.get<ApprovalSummary>("/api/approvals/summary");
    if (mode === "json") {
      emit("json", sum);
      return 0;
    }
    const lines = [
      `approvals · ${sum.pending.total} pending`,
      `  urgent     ${sum.pending.urgent}`,
      `  normal     ${sum.pending.normal}`,
      `  low        ${sum.pending.low}`,
      "",
      "last 7 days:",
      `  approved   ${sum.recent.approved_7d}`,
      `  declined   ${sum.recent.declined_7d}`,
      `  expired    ${sum.recent.expired_7d}`,
    ];
    emit("pretty", lines.join("\n"));
    return 0;
  }

  const status = typeof args.flags.status === "string" ? args.flags.status : "pending";
  const items = await client.get<Approval[]>("/api/approvals", { status, limit: 50 });
  if (mode === "json") {
    emit("json", items);
    return 0;
  }
  if (items.length === 0) {
    emit("pretty", `no approvals (status=${status})`);
    return 0;
  }
  const lines = [`approvals · ${items.length} (status=${status})`];
  for (const a of items) {
    const urg = a.urgency === "urgent" ? "‼ " : "  ";
    lines.push(
      `${urg}${a.id.slice(0, 8)} ${a.action_kind.padEnd(20)} ${trunc(a.reason ?? "", 50).padEnd(50)} ${relative(a.created_at)}`,
    );
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runApprovalResolve(args: ParsedArgs, client: Client): Promise<number> {
  const verb = args.subcommand!; // "approve" | "decline"
  const id = args.positional[0];
  const note = args.positional.slice(1).join(" ").trim() || undefined;
  if (!id) {
    process.stderr.write(`usage: bc ${verb} <approval_id> [note]\n`);
    return 2;
  }
  const path = verb === "approve" ? "approve" : "decline";
  const out = await client.post<Approval>(`/api/approvals/${encodeURIComponent(id)}/${path}`, {
    note,
  });
  emit(detectMode(args.flags), `${verb}d ${out.id}`);
  return 0;
}
