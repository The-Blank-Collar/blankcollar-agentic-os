import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { detectMode, emit } from "../format.js";

type Briefing = {
  id: string;
  kind: "daily" | "weekly" | "on_demand";
  generated_at: string;
  summary_md: string;
  sources: Record<string, unknown>;
};

export async function runBriefing(args: ParsedArgs, client: Client): Promise<number> {
  const sub = args.positional[0];
  let data: Briefing;
  if (sub === "generate") {
    data = await client.post<Briefing>("/api/briefing/generate", {
      kind: typeof args.flags.kind === "string" ? args.flags.kind : "on_demand",
    });
  } else {
    data = await client.get<Briefing>("/api/briefing/today");
  }
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", data);
    return 0;
  }
  emit("pretty", data.summary_md);
  return 0;
}
