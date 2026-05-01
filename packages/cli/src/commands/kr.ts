import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagString } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type Kr = {
  id: string;
  goal_id: string;
  label: string;
  target_value: string | null;
  current_value: string | null;
  unit: string | null;
  weight: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function runKrList(args: ParsedArgs, client: Client): Promise<number> {
  const goalId = args.positional[0];
  if (!goalId) {
    process.stderr.write("usage: bc kr list <goal_id>\n");
    return 2;
  }
  const krs = await client.get<Kr[]>(`/api/goals/${encodeURIComponent(goalId)}/key-results`);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", krs);
    return 0;
  }
  if (krs.length === 0) {
    emit("pretty", "no key results.");
    return 0;
  }
  const lines = [`key results · ${krs.length} on goal ${goalId.slice(0, 8)}`];
  for (const kr of krs) {
    const progress = kr.target_value
      ? `${kr.current_value ?? "—"} / ${kr.target_value}${kr.unit ? ` ${kr.unit}` : ""}`
      : "(no target)";
    const due = kr.due_at ? `  · due ${relative(kr.due_at)}` : "";
    lines.push(`  ${kr.id.slice(0, 8)} ${trunc(kr.label, 50).padEnd(50)} [${progress}]${due}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runKrAdd(args: ParsedArgs, client: Client): Promise<number> {
  const goalId = args.positional[0];
  const label = args.positional.slice(1).join(" ").trim();
  if (!goalId || !label) {
    process.stderr.write("usage: bc kr add <goal_id> <label> [--target=N] [--current=N] [--unit=X]\n");
    return 2;
  }
  const target = flagString(args.flags, "target", "");
  const current = flagString(args.flags, "current", "");
  const unit = flagString(args.flags, "unit", "");
  const due = flagString(args.flags, "due", "");

  const body: Record<string, unknown> = { label };
  if (target) body.target_value = target;
  if (current) body.current_value = current;
  if (unit) body.unit = unit;
  if (due) body.due_at = due;

  const kr = await client.post<Kr>(
    `/api/goals/${encodeURIComponent(goalId)}/key-results`,
    body,
  );
  emit(detectMode(args.flags), `added · ${kr.id.slice(0, 8)} ${kr.label}`);
  return 0;
}

export async function runKrSet(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  const value = args.positional[1];
  if (!id || value === undefined) {
    process.stderr.write("usage: bc kr set <kr_id> <current_value> [--unit=X]\n");
    return 2;
  }
  const unit = flagString(args.flags, "unit", "");
  const body: Record<string, unknown> = { current_value: value };
  if (unit) body.unit = unit;
  const kr = await client.patch<Kr>(`/api/key-results/${encodeURIComponent(id)}`, body);
  const target = kr.target_value ? ` / ${kr.target_value}` : "";
  emit(detectMode(args.flags), `updated · ${kr.id.slice(0, 8)} ${kr.label} = ${kr.current_value ?? "—"}${target}`);
  return 0;
}

export async function runKrRm(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    process.stderr.write("usage: bc kr rm <kr_id>\n");
    return 2;
  }
  await client.del(`/api/key-results/${encodeURIComponent(id)}`);
  emit(detectMode(args.flags), `removed · ${id.slice(0, 8)}`);
  return 0;
}
