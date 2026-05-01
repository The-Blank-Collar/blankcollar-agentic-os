import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagString } from "../argv.js";
import { detectMode, emit, trunc } from "../format.js";

type Tool = {
  id: string;
  slug: string;
  version: number;
  scope: "personal" | "company" | "shared";
  name: string;
  description: string | null;
  transport: "stdio" | "http" | "sse" | "websocket";
  target: string;
  env_keys: string[];
  input_schema: Record<string, unknown>;
  enabled: boolean;
};

export async function runToolsList(args: ParsedArgs, client: Client): Promise<number> {
  const transport = flagString(args.flags, "transport", "");
  const params: Record<string, string | number | boolean | undefined> = {};
  if (transport) params.transport = transport;

  const tools = await client.get<Tool[]>("/api/tools", params);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", tools);
    return 0;
  }
  if (tools.length === 0) {
    emit("pretty", "no tools registered.");
    return 0;
  }
  const lines = [`tools · ${tools.length}`];
  for (const t of tools) {
    const flag = t.enabled ? " " : "·";
    lines.push(`  ${flag} ${t.slug.padEnd(28)} ${t.scope.padEnd(8)} ${t.transport.padEnd(10)} ${trunc(t.name, 40)}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runToolGet(args: ParsedArgs, client: Client): Promise<number> {
  const slug = args.positional[0];
  if (!slug) {
    process.stderr.write("usage: bc tool <slug>\n");
    return 2;
  }
  const t = await client.get<Tool>(`/api/tools/${encodeURIComponent(slug)}`);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", t);
    return 0;
  }
  const lines = [
    `${t.slug}  v${t.version}  (${t.scope})`,
    t.name,
    "",
    t.description ?? "",
    "",
    `transport: ${t.transport}`,
    `target:    ${t.target}`,
  ];
  if (t.env_keys.length > 0) {
    lines.push(`env keys:  ${t.env_keys.join(", ")}`);
  }
  if (Object.keys(t.input_schema).length > 0) {
    lines.push("", "inputs:");
    for (const [k, v] of Object.entries(t.input_schema)) {
      const meta = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
      lines.push(`  ${k}: ${trunc(meta, 80)}`);
    }
  }
  emit("pretty", lines.join("\n"));
  return 0;
}
