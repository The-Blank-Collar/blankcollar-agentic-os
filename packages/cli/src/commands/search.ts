import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagInt, flagString } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type Hit = {
  kind: "goal" | "capture" | "knowledge" | "agent";
  id: string;
  title: string;
  snippet: string | null;
  score: number;
  created_at: string;
  metadata: Record<string, unknown>;
};

const KIND_GLYPH: Record<Hit["kind"], string> = {
  goal: "◎",
  capture: "✎",
  knowledge: "📖",
  agent: "✦",
};

export async function runSearch(args: ParsedArgs, client: Client): Promise<number> {
  const q = args.positional.join(" ").trim();
  if (q.length < 2) {
    process.stderr.write("usage: bc search <query> [--kind=goal|capture|knowledge|agent] [--limit=N]\n");
    return 2;
  }
  const limit = flagInt(args.flags, "limit", 20);
  const kind = flagString(args.flags, "kind", "all");
  const params: Record<string, string | number | boolean | undefined> = { q, limit };
  if (kind !== "all") params.kind = kind;

  const hits = await client.get<Hit[]>("/api/search", params);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", hits);
    return 0;
  }
  if (hits.length === 0) {
    emit("pretty", `no hits for "${q}".`);
    return 0;
  }
  const lines = [`search · ${hits.length} hit${hits.length === 1 ? "" : "s"} for "${q}"`];
  for (const h of hits) {
    const glyph = KIND_GLYPH[h.kind] ?? "·";
    lines.push(`  ${glyph} ${h.kind.padEnd(9)} ${trunc(h.title, 60)}  ${relative(h.created_at)}  ${h.id.slice(0, 8)}`);
    if (h.snippet) {
      lines.push(`      ${trunc(h.snippet.replace(/\s+/g, " "), 100)}`);
    }
  }
  emit("pretty", lines.join("\n"));
  return 0;
}
