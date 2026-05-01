import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagInt } from "../argv.js";
import { detectMode, emit } from "../format.js";

type Report = {
  id: string;
  kind: "audit" | "level_up";
  period_start: string;
  period_end: string;
  summary_md: string;
  findings: Array<{ category: string; detail: string }>;
  suggestions: Array<{ category: string; proposal: string }>;
};

export async function runAudit(args: ParsedArgs, client: Client): Promise<number> {
  const period = flagInt(args.flags, "hours", 168);
  const data = await client.post<Report>("/api/self/audit", {
    period_hours: period,
    kind: "audit",
  });
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", data);
    return 0;
  }
  emit("pretty", data.summary_md);
  return 0;
}

export async function runLevelUp(args: ParsedArgs, client: Client): Promise<number> {
  const auditId = typeof args.flags.audit === "string" ? args.flags.audit : undefined;
  const data = await client.post<Report>("/api/self/level-up", auditId ? { audit_report_id: auditId } : {});
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", data);
    return 0;
  }
  emit("pretty", data.summary_md);
  return 0;
}
