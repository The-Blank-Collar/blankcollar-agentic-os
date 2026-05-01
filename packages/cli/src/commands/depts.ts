import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { detectMode, emit, relative } from "../format.js";

type Dept = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  active_goal_count: number;
};

export async function runDepartments(args: ParsedArgs, client: Client): Promise<number> {
  const rows = await client.get<Dept[]>("/api/departments");
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", rows);
    return 0;
  }
  if (rows.length === 0) {
    emit("pretty", "no departments.");
    return 0;
  }
  const lines = [`departments · ${rows.length}`];
  for (const d of rows) {
    lines.push(`  ${d.id.slice(0, 8)} ${d.slug.padEnd(16)} ${d.name.padEnd(28)} ${d.active_goal_count} active goal${d.active_goal_count === 1 ? "" : "s"}  · ${relative(d.created_at)}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}
