import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagBool, flagInt, flagString } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type UpstreamSource = {
  id: string;
  scope: string;
  name: string;
  source_url: string;
  tags: string[];
  refresh_interval_seconds: number;
  last_pulled_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_document_id: string | null;
  consecutive_failures: number;
  enabled: boolean;
  created_at: string;
};

type PullOutcome =
  | { status: "ok"; document_id: string; chunk_count: number; latency_ms: number }
  | { status: "unchanged"; document_id: string | null; latency_ms: number }
  | { status: "failed"; error: string; latency_ms: number };

type PullResp = {
  source_id: string;
  outcome: PullOutcome;
};

const STATUS_GLYPH: Record<string, string> = {
  ok: "✓",
  unchanged: "·",
  failed: "✗",
};

function intervalLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

const HELP_USAGE = `usage:
  bc upstream add <url> [--name=...] [--tags=a,b,c] [--scope=...] [--interval=86400]
                                       register an external URL for periodic refresh
  bc upstream                          list registered sources
  bc upstream pull <id>                manual refresh now (synchronous)
  bc upstream remove <id>              stop tracking + delete linked document
  bc upstream <id>                     show one source's full state
  bc upstream enable <id>               re-enable an auto-disabled source
  bc upstream disable <id>             stop the scheduler from pulling

defaults: --interval=86400 (24h). minimum 60s, maximum 30 days.
`;

export async function runUpstreamAdd(args: ParsedArgs, client: Client): Promise<number> {
  const url = args.positional[0] ?? "";
  if (!url) {
    process.stderr.write(HELP_USAGE);
    return 2;
  }
  const name = flagString(args.flags, "name", "") || url;
  const scope = flagString(args.flags, "scope", "company");
  const interval = flagInt(args.flags, "interval", 86_400);
  const tagsCsv = flagString(args.flags, "tags", "");
  const tags = tagsCsv
    ? tagsCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const out = await client.post<UpstreamSource>("/api/upstream", {
    name,
    source_url: url,
    scope,
    tags,
    refresh_interval_seconds: interval,
  });
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", out);
    return 0;
  }
  emit(
    "pretty",
    `registered · ${out.id.slice(0, 8)}  ${out.name}\n  every ${intervalLabel(out.refresh_interval_seconds)}  · ${out.source_url}`,
  );
  return 0;
}

export async function runUpstreamList(args: ParsedArgs, client: Client): Promise<number> {
  const params: Record<string, string | number | boolean | undefined> = {};
  if (flagBool(args.flags, "disabled")) params.enabled = "false";
  if (flagBool(args.flags, "enabled")) params.enabled = "true";
  const tag = flagString(args.flags, "tag", "");
  if (tag) params.tag = tag;
  const rows = await client.get<UpstreamSource[]>("/api/upstream", params);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", rows);
    return 0;
  }
  if (rows.length === 0) {
    emit("pretty", "no upstream sources registered.");
    return 0;
  }
  const lines = [`upstream sources · ${rows.length}`];
  for (const r of rows) {
    const status = r.last_status ?? "—";
    const glyph = r.enabled ? (STATUS_GLYPH[status] ?? "?") : "○";
    const last = r.last_pulled_at ? relative(r.last_pulled_at) : "never";
    const fail = r.consecutive_failures > 0 ? `  failures=${r.consecutive_failures}` : "";
    lines.push(
      `  ${glyph} ${r.id.slice(0, 8)} ${trunc(r.name, 30).padEnd(30)} every ${intervalLabel(r.refresh_interval_seconds).padStart(4)}  last ${last}${fail}`,
    );
    lines.push(`        ${trunc(r.source_url, 90)}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runUpstreamGet(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    process.stderr.write("usage: bc upstream <id>\n");
    return 2;
  }
  const r = await client.get<UpstreamSource>(`/api/upstream/${encodeURIComponent(id)}`);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", r);
    return 0;
  }
  const lines = [
    `${r.id}  ${r.scope}  ${r.enabled ? "enabled" : "DISABLED"}`,
    r.name,
    "",
    `  url:        ${r.source_url}`,
    `  every:      ${intervalLabel(r.refresh_interval_seconds)}`,
    `  last:       ${r.last_pulled_at ? relative(r.last_pulled_at) : "never"}  (${r.last_status ?? "—"})`,
  ];
  if (r.last_error) lines.push(`  error:      ${trunc(r.last_error, 200)}`);
  if (r.consecutive_failures > 0) lines.push(`  failures:   ${r.consecutive_failures}`);
  if (r.last_document_id) lines.push(`  document:   ${r.last_document_id}`);
  if (r.tags.length > 0) lines.push(`  tags:       ${r.tags.join(", ")}`);
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runUpstreamPull(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    process.stderr.write("usage: bc upstream pull <id>\n");
    return 2;
  }
  const r = await client.post<PullResp>(`/api/upstream/${encodeURIComponent(id)}/pull`, {});
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", r);
    return 0;
  }
  const out = r.outcome;
  if (out.status === "ok") {
    emit(
      "pretty",
      `${STATUS_GLYPH.ok} pulled · ${out.chunk_count} chunk${out.chunk_count === 1 ? "" : "s"}  · ${out.latency_ms}ms\n  document: ${out.document_id.slice(0, 8)}`,
    );
    return 0;
  }
  if (out.status === "unchanged") {
    emit(
      "pretty",
      `${STATUS_GLYPH.unchanged} unchanged · same content as last pull  · ${out.latency_ms}ms`,
    );
    return 0;
  }
  emit("pretty", `${STATUS_GLYPH.failed} failed · ${out.error}  · ${out.latency_ms}ms`);
  return 1;
}

export async function runUpstreamPatch(
  args: ParsedArgs,
  client: Client,
  patch: Record<string, unknown>,
): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    process.stderr.write("usage: bc upstream (enable|disable) <id>\n");
    return 2;
  }
  const r = await client.request<UpstreamSource>({
    method: "PATCH",
    path: `/api/upstream/${encodeURIComponent(id)}`,
    body: patch,
  });
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", r);
    return 0;
  }
  emit("pretty", `${r.enabled ? "enabled" : "disabled"} · ${r.id.slice(0, 8)}  ${r.name}`);
  return 0;
}

export async function runUpstreamRemove(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    process.stderr.write("usage: bc upstream remove <id>\n");
    return 2;
  }
  await client.del(`/api/upstream/${encodeURIComponent(id)}`);
  emit(detectMode(args.flags), `removed · ${id.slice(0, 8)}`);
  return 0;
}

/** `bc upstream` dispatcher — list-by-default + verb sub-routing. */
export async function runUpstream(args: ParsedArgs, client: Client): Promise<number> {
  const verb = args.positional[0];
  if (!verb) return await runUpstreamList(args, client);
  const sub = { ...args, positional: args.positional.slice(1) };
  switch (verb) {
    case "add":
      return await runUpstreamAdd(sub, client);
    case "list":
      return await runUpstreamList(sub, client);
    case "pull":
      return await runUpstreamPull(sub, client);
    case "remove":
    case "rm":
    case "delete":
      return await runUpstreamRemove(sub, client);
    case "enable":
      return await runUpstreamPatch(sub, client, { enabled: true });
    case "disable":
      return await runUpstreamPatch(sub, client, { enabled: false });
    default:
      // Treat the first positional as a source ID
      return await runUpstreamGet(args, client);
  }
}
