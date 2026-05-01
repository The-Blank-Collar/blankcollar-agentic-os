import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagInt, flagString } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type AuditEntry = {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function runLogs(args: ParsedArgs, client: Client): Promise<number> {
  const limit = flagInt(args.flags, "limit", 30);
  const action = flagString(args.flags, "action", "");
  const targetType = flagString(args.flags, "target", "");
  const params: Record<string, string | number | boolean | undefined> = { limit };
  if (action) params.action = action;
  if (targetType) params.target_type = targetType;

  const rows = await client.get<AuditEntry[]>("/api/audit", params);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", rows);
    return 0;
  }
  if (rows.length === 0) {
    emit("pretty", "no audit entries.");
    return 0;
  }
  const lines = [`audit · ${rows.length} most recent`];
  for (const r of rows) {
    const target = r.target_id ? `${r.target_type ?? "?"}:${r.target_id.slice(0, 8)}` : "—";
    const actor = r.actor_role ?? (r.actor_id ? r.actor_id.slice(0, 8) : "system");
    const meta = Object.keys(r.metadata ?? {}).length > 0
      ? `  ${trunc(JSON.stringify(r.metadata), 60)}`
      : "";
    lines.push(`  ${r.action.padEnd(28)} ${actor.padEnd(12)} ${target.padEnd(22)}  ${relative(r.created_at)}${meta}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}
