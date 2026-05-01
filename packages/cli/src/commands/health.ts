import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { detectMode, emit } from "../format.js";

type HealthResp = {
  ok: boolean;
  version: string;
  env: string;
  probes: Record<string, { ok: boolean; error?: string }>;
  runtime?: {
    worker_enabled?: boolean;
    scheduler_enabled?: boolean;
    briefing_hour_utc?: number;
    llm_configured?: boolean;
  };
  counts?: Record<string, number>;
};

export async function runHealth(args: ParsedArgs, client: Client): Promise<number> {
  const mode = detectMode(args.flags);
  const data = await client.get<HealthResp>("/api/health");
  if (mode === "json") {
    emit("json", data);
    return data.ok ? 0 : 1;
  }
  const lines: string[] = [];
  lines.push(`paperclip ${data.version} · env=${data.env} · ${data.ok ? "ok" : "DEGRADED"}`);
  for (const [name, probe] of Object.entries(data.probes)) {
    const mark = probe.ok ? "✓" : "✗";
    const detail = probe.error ? ` (${probe.error})` : "";
    lines.push(`  ${mark} ${name}${detail}`);
  }
  if (data.runtime) {
    const r = data.runtime;
    const flags = [
      `worker=${r.worker_enabled ? "on" : "off"}`,
      `scheduler=${r.scheduler_enabled ? "on" : "off"}`,
      `briefing=${r.briefing_hour_utc ?? "?"}:00 UTC`,
      `llm=${r.llm_configured ? "configured" : "templated"}`,
    ];
    lines.push(`  runtime: ${flags.join(" · ")}`);
  }
  if (data.counts) {
    const c = data.counts;
    lines.push(
      `  counts: skills=${c.skills_enabled ?? 0} agents=${c.agents_active ?? 0} routines=${c.routines_active ?? 0} approvals=${c.approvals_pending ?? 0}`,
    );
  }
  emit("pretty", lines.join("\n"));
  return data.ok ? 0 : 1;
}
