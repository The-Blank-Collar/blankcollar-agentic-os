import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { detectMode, emit } from "../format.js";

type CaptureResp = {
  capture_id: string;
  goal_id: string;
  intent: { kind: string; title: string; cron_expr?: string; target_value?: string };
  kr_id?: string;
  created_at: string;
};

export async function runCapture(args: ParsedArgs, client: Client): Promise<number> {
  const text = args.positional.join(" ").trim();
  if (!text) {
    process.stderr.write("usage: bc capture <text>\n");
    return 2;
  }
  const data = await client.post<CaptureResp>("/api/capture", {
    raw_content: text,
    source: "text",
  });
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", data);
    return 0;
  }
  const tag =
    data.intent.kind === "routine" && data.intent.cron_expr
      ? ` (cron ${data.intent.cron_expr})`
      : data.intent.target_value
        ? ` (target ${data.intent.target_value})`
        : "";
  const krNote = data.kr_id ? "\n  + key result auto-populated" : "";
  emit("pretty", `captured · kind=${data.intent.kind}${tag}\n  goal: ${data.goal_id}${krNote}`);
  return 0;
}
