import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagString } from "../argv.js";
import { detectMode, emit } from "../format.js";

type CaptureResp = {
  capture_id: string;
  goal_id: string;
  intent: { kind: string; title: string; cron_expr?: string; target_value?: string };
  kr_id?: string;
  created_at: string;
};

const VALID_KINDS = new Set(["ephemeral", "standing", "routine", "decision"]);

export async function runCapture(args: ParsedArgs, client: Client): Promise<number> {
  const text = args.positional.join(" ").trim();
  if (!text) {
    process.stderr.write("usage: bc capture <text> [--kind=ephemeral|standing|routine|decision]\n");
    return 2;
  }
  const kind = flagString(args.flags, "kind", "");
  if (kind && !VALID_KINDS.has(kind)) {
    process.stderr.write(`invalid --kind: ${kind} (must be one of ${[...VALID_KINDS].join("|")})\n`);
    return 2;
  }
  const body: Record<string, unknown> = { raw_content: text, source: "text" };
  if (kind) body.kind = kind;
  const data = await client.post<CaptureResp>("/api/capture", body);
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
