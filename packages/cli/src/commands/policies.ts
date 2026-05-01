import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagInt, flagString } from "../argv.js";
import { detectMode, emit, relative } from "../format.js";

type Policy = {
  id: string;
  role: string | null;
  agent_kind: string | null;
  skill_slug: string | null;
  action_kind: string | null;
  effect: "allow" | "approve" | "deny";
  priority: number;
  reason: string | null;
  created_at: string;
};

const EFFECT_GLYPH: Record<Policy["effect"], string> = {
  allow: "✓",
  approve: "?",
  deny: "✗",
};

export async function runPoliciesList(args: ParsedArgs, client: Client): Promise<number> {
  const rows = await client.get<Policy[]>("/api/policies");
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", rows);
    return 0;
  }
  if (rows.length === 0) {
    emit("pretty", "no policies (default-allow).");
    return 0;
  }
  const lines = [`policies · ${rows.length}`];
  for (const p of rows) {
    const wildcards = [p.role, p.agent_kind, p.skill_slug, p.action_kind].map((v) => v ?? "*");
    const match = `${wildcards[0]} · ${wildcards[1]} · ${wildcards[2]} · ${wildcards[3]}`;
    const reason = p.reason ? `  — ${p.reason}` : "";
    lines.push(`  ${EFFECT_GLYPH[p.effect]} ${String(p.priority).padStart(4)} ${p.effect.padEnd(8)} ${match}${reason}  ${relative(p.created_at)}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runPolicyAdd(args: ParsedArgs, client: Client): Promise<number> {
  const effect = flagString(args.flags, "effect", "");
  if (!["allow", "approve", "deny"].includes(effect)) {
    process.stderr.write("usage: bc policy add --effect=allow|approve|deny [--role=R --agent=A --skill=S --action=K --priority=N --reason=...]\n");
    return 2;
  }
  const body: Record<string, unknown> = { effect, priority: flagInt(args.flags, "priority", 100) };
  const role = flagString(args.flags, "role", "");
  const agent = flagString(args.flags, "agent", "");
  const skill = flagString(args.flags, "skill", "");
  const action = flagString(args.flags, "action", "");
  const reason = flagString(args.flags, "reason", "");
  if (role) body.role = role;
  if (agent) body.agent_kind = agent;
  if (skill) body.skill_slug = skill;
  if (action) body.action_kind = action;
  if (reason) body.reason = reason;
  const out = await client.post<Policy>("/api/policies", body);
  emit(detectMode(args.flags), `added · ${out.id.slice(0, 8)} ${out.effect} (priority=${out.priority})`);
  return 0;
}

export async function runPolicyRm(args: ParsedArgs, client: Client): Promise<number> {
  const id = args.positional[0];
  if (!id) {
    process.stderr.write("usage: bc policy rm <policy_id>\n");
    return 2;
  }
  await client.del(`/api/policies/${encodeURIComponent(id)}`);
  emit(detectMode(args.flags), `removed · ${id.slice(0, 8)}`);
  return 0;
}

type EvaluateResult = {
  effect: Policy["effect"];
  matched: Policy | null;
};

export async function runPolicyTest(args: ParsedArgs, client: Client): Promise<number> {
  const role = flagString(args.flags, "role", "");
  const agent = flagString(args.flags, "agent", "");
  const skill = flagString(args.flags, "skill", "");
  const action = flagString(args.flags, "action", "");
  const body: Record<string, unknown> = {};
  if (role) body.role = role;
  if (agent) body.agent_kind = agent;
  if (skill) body.skill_slug = skill;
  if (action) body.action_kind = action;
  const out = await client.post<EvaluateResult>("/api/policies/evaluate", body);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", out);
    return 0;
  }
  if (!out.matched) {
    emit("pretty", `${EFFECT_GLYPH[out.effect]} ${out.effect}  (no policy matched, default-allow)`);
    return 0;
  }
  const m = out.matched;
  emit("pretty", `${EFFECT_GLYPH[out.effect]} ${out.effect}  via ${m.id.slice(0, 8)}${m.reason ? ` — ${m.reason}` : ""}`);
  return 0;
}
