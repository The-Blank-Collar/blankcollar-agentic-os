import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagInt, flagString } from "../argv.js";
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

type InvokeResp = {
  slug: string;
  version: number;
  output: unknown;
  latency_ms: number;
};

/**
 * `bc tool invoke <slug> --input.x=y --input.url=https://...` calls the
 * MCP tool through paperclip's POST /api/tools/:slug/invoke endpoint.
 * The `--input.foo=bar` flags are folded into a single `input` object;
 * numeric-looking values become numbers, "true"/"false" become booleans,
 * everything else stays string.
 */
export async function runToolInvoke(args: ParsedArgs, client: Client): Promise<number> {
  const slug = args.positional[0];
  if (!slug) {
    process.stderr.write("usage: bc tool invoke <slug> [--input.x=y ...] [--timeout=ms]\n");
    return 2;
  }
  const input: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.flags)) {
    if (!k.startsWith("input.")) continue;
    const key = k.slice("input.".length);
    if (v === true) {
      input[key] = true;
    } else if (typeof v === "string") {
      // Light coercion — most MCP tools take strings, but URLs sometimes need
      // numbers (port, limit). Keep it predictable.
      if (v === "true") input[key] = true;
      else if (v === "false") input[key] = false;
      else if (/^-?\d+(\.\d+)?$/.test(v)) input[key] = Number(v);
      else input[key] = v;
    }
  }
  const body: Record<string, unknown> = { input };
  const timeoutMs = flagInt(args.flags, "timeout", -1);
  if (timeoutMs > 0) body.timeout_ms = timeoutMs;
  const runId = flagString(args.flags, "run", "");
  if (runId) body.run_id = runId;

  const out = await client.post<InvokeResp>(`/api/tools/${encodeURIComponent(slug)}/invoke`, body);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", out);
    return 0;
  }
  // Pretty: header line + indented JSON of the output.
  const lines = [
    `${out.slug} v${out.version}  ✓  ${out.latency_ms}ms`,
    "",
    typeof out.output === "string"
      ? out.output
      : JSON.stringify(out.output, null, 2),
  ];
  emit("pretty", lines.join("\n"));
  return 0;
}

type ProbeResp = {
  slug: string;
  ok: boolean;
  latency_ms: number;
  error: string | null;
  stderr_tail: string | null;
};

export async function runToolProbe(args: ParsedArgs, client: Client): Promise<number> {
  const slug = args.positional[0];
  if (!slug) {
    process.stderr.write("usage: bc tool probe <slug>\n");
    return 2;
  }
  const out = await client.post<ProbeResp>(`/api/tools/${encodeURIComponent(slug)}/probe`, {});
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", out);
    return 0;
  }
  if (out.ok) {
    emit("pretty", `${out.slug}  ✓ healthy  ${out.latency_ms}ms`);
    return 0;
  }
  const lines = [
    `${out.slug}  ✗ unhealthy  ${out.latency_ms}ms`,
    `  error: ${out.error ?? "(unknown)"}`,
  ];
  if (out.stderr_tail) {
    lines.push("  stderr tail:");
    for (const line of out.stderr_tail.split("\n").slice(-5)) {
      if (line.trim()) lines.push(`    ${line}`);
    }
  }
  emit("pretty", lines.join("\n"));
  return 1;
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
