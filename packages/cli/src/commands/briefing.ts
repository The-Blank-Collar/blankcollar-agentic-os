import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagInt, flagString } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type Briefing = {
  id: string;
  kind: "daily" | "weekly" | "on_demand";
  generated_at: string;
  summary_md: string;
  sources: Record<string, unknown>;
};

export async function runBriefing(args: ParsedArgs, client: Client): Promise<number> {
  const sub = args.positional[0];
  const mode = detectMode(args.flags);

  if (sub === "list") {
    const kind = flagString(args.flags, "kind", "");
    const limit = flagInt(args.flags, "limit", 10);
    const params: Record<string, string | number | boolean | undefined> = { limit };
    if (kind) params.kind = kind;
    const rows = await client.get<Briefing[]>("/api/briefing", params);
    if (mode === "json") {
      emit("json", rows);
      return 0;
    }
    if (rows.length === 0) {
      emit("pretty", "no briefings.");
      return 0;
    }
    const lines = [`briefings · ${rows.length} most recent${kind ? ` (kind=${kind})` : ""}`];
    for (const b of rows) {
      const head = (b.summary_md ?? "").split("\n").find((l) => l.trim()) ?? "";
      lines.push(`  ${b.id.slice(0, 8)} ${b.kind.padEnd(10)} ${trunc(head.replace(/^#+\s*/, ""), 70)}  ${relative(b.generated_at)}`);
    }
    emit("pretty", lines.join("\n"));
    return 0;
  }

  let data: Briefing;
  if (sub === "generate") {
    data = await client.post<Briefing>("/api/briefing/generate", {
      kind: typeof args.flags.kind === "string" ? args.flags.kind : "on_demand",
    });
  } else {
    data = await client.get<Briefing>("/api/briefing/today");
  }
  if (mode === "json") {
    emit("json", data);
    return 0;
  }
  emit("pretty", data.summary_md);
  return 0;
}
