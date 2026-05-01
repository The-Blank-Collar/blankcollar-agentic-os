import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { detectMode, emit } from "../format.js";

type Status = "active" | "paused" | "achieved" | "archived";

const VERB_TO_STATUS: Record<string, Status> = {
  close: "achieved",
  pause: "paused",
  resume: "active",
  archive: "archived",
};

export async function runGoalStatus(args: ParsedArgs, client: Client): Promise<number> {
  const verb = args.subcommand ?? "";
  const status = VERB_TO_STATUS[verb];
  if (!status) {
    process.stderr.write(`unknown goal-status verb: ${verb}\n`);
    return 2;
  }
  const id = args.positional[0];
  if (!id) {
    process.stderr.write(`usage: bc ${verb} <goal_id>\n`);
    return 2;
  }
  const out = await client.patch<{ id: string; status: string; title: string }>(
    `/api/goals/${encodeURIComponent(id)}`,
    { status },
  );
  emit(detectMode(args.flags), `${verb}d · ${out.id.slice(0, 8)} (status=${out.status})`);
  return 0;
}
