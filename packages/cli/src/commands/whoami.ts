import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { detectMode, emit } from "../format.js";

type WhoAmI = {
  org: { id: string; slug: string | null; name: string | null };
  role: string;
  department: { id: string; name: string } | null;
  goal_id: string | null;
};

export async function runWhoami(args: ParsedArgs, client: Client): Promise<number> {
  const me = await client.get<WhoAmI>("/api/whoami");
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", me);
    return 0;
  }
  const lines = [
    `org:        ${me.org.slug ?? me.org.id}${me.org.name ? `  (${me.org.name})` : ""}`,
    `role:       ${me.role}`,
    `department: ${me.department ? me.department.name : "—"}`,
  ];
  if (me.goal_id) lines.push(`goal:       ${me.goal_id}`);
  emit("pretty", lines.join("\n"));
  return 0;
}
