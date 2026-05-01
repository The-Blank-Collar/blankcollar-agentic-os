import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagBool, flagInt } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type InboxItem = {
  item_kind: "approval" | "decision" | "blocked" | "routine_output" | "draft";
  goal_id: string;
  title: string;
  created_at: string;
  urgency: "urgent" | "normal";
  metadata: Record<string, unknown>;
};

type InboxSummary = {
  total: number;
  urgent: number;
  by_kind: Record<InboxItem["item_kind"], number>;
};

const KIND_LABEL: Record<InboxItem["item_kind"], string> = {
  approval: "approval ",
  decision: "decision ",
  routine_output: "routine  ",
  draft: "draft    ",
  blocked: "blocked  ",
};

export async function runInboxList(args: ParsedArgs, client: Client): Promise<number> {
  const mode = detectMode(args.flags);

  if (flagBool(args.flags, "summary")) {
    const sum = await client.get<InboxSummary>("/api/inbox/summary");
    if (mode === "json") {
      emit("json", sum);
      return 0;
    }
    const urgent = sum.urgent > 0 ? `  · ${sum.urgent} urgent` : "";
    const lines = [
      `inbox · ${sum.total} item${sum.total === 1 ? "" : "s"}${urgent}`,
      `  approval        ${sum.by_kind.approval}`,
      `  decision        ${sum.by_kind.decision}`,
      `  routine output  ${sum.by_kind.routine_output}`,
      `  draft           ${sum.by_kind.draft}`,
      `  blocked         ${sum.by_kind.blocked}`,
    ];
    emit("pretty", lines.join("\n"));
    return 0;
  }

  const limit = flagInt(args.flags, "limit", 20);
  const items = await client.get<InboxItem[]>("/api/inbox", { limit });
  if (mode === "json") {
    emit("json", items);
    return 0;
  }
  if (items.length === 0) {
    emit("pretty", "inbox empty.");
    return 0;
  }
  const lines: string[] = [`inbox · ${items.length} item${items.length === 1 ? "" : "s"}`];
  for (const it of items) {
    const urg = it.urgency === "urgent" ? "‼ " : "  ";
    lines.push(
      `${urg}${KIND_LABEL[it.item_kind]} ${trunc(it.title, 80)}  ${relative(it.created_at)}  ${it.goal_id.slice(0, 8)}`,
    );
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runInboxAck(args: ParsedArgs, client: Client): Promise<number> {
  const goalId = args.positional[0];
  if (!goalId) {
    process.stderr.write("usage: bc inbox ack <goal_id>\n");
    return 2;
  }
  const res = await client.post<{ kind: string; runs_acknowledged: number }>(
    `/api/inbox/acknowledge/${encodeURIComponent(goalId)}`,
  );
  emit(detectMode(args.flags), `acknowledged ${res.runs_acknowledged} run(s)`);
  return 0;
}
