import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagInt } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type InboxItem = {
  item_kind: "approval" | "decision" | "blocked" | "routine_output" | "draft";
  goal_id: string;
  title: string;
  created_at: string;
  urgency: "urgent" | "normal";
  metadata: Record<string, unknown>;
};

const KIND_LABEL: Record<InboxItem["item_kind"], string> = {
  approval: "approval ",
  decision: "decision ",
  routine_output: "routine  ",
  draft: "draft    ",
  blocked: "blocked  ",
};

export async function runInboxList(args: ParsedArgs, client: Client): Promise<number> {
  const limit = flagInt(args.flags, "limit", 20);
  const items = await client.get<InboxItem[]>("/api/inbox", { limit });
  const mode = detectMode(args.flags);
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
