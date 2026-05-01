import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagString } from "../argv.js";
import { detectMode, emit, trunc } from "../format.js";

type Skill = {
  id: string;
  slug: string;
  scope: string;
  agent_kind: string;
  title: string;
  description: string | null;
  enabled: boolean;
};

export async function runSkills(args: ParsedArgs, client: Client): Promise<number> {
  const scope = flagString(args.flags, "scope", "");
  const agentKind = flagString(args.flags, "agent", "");
  const params: Record<string, string | number | boolean | undefined> = {};
  if (scope) params.scope = scope;
  if (agentKind) params.agent_kind = agentKind;

  const skills = await client.get<Skill[]>("/api/skills", params);
  const mode = detectMode(args.flags);
  if (mode === "json") {
    emit("json", skills);
    return 0;
  }
  const filterTag =
    scope || agentKind ? ` (${[scope && `scope=${scope}`, agentKind && `agent=${agentKind}`].filter(Boolean).join(", ")})` : "";
  const lines = [`skills · ${skills.length}${filterTag}`];
  for (const s of skills) {
    lines.push(`  ${s.slug.padEnd(30)} ${s.scope.padEnd(10)} ${s.agent_kind.padEnd(10)} ${trunc(s.title, 50)}`);
  }
  emit("pretty", lines.join("\n"));
  return 0;
}

export async function runSkillInvoke(args: ParsedArgs, client: Client): Promise<number> {
  const slug = args.positional[0];
  if (!slug) {
    process.stderr.write('usage: bc skill invoke <slug> [--input.url=... --input.query=...]\n');
    return 2;
  }
  const inputs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.flags)) {
    if (k.startsWith("input.")) {
      inputs[k.slice("input.".length)] = v === true ? true : v;
    }
  }
  const out = await client.post<{ run_id: string; goal_id: string }>(
    `/api/skills/${encodeURIComponent(slug)}/invoke`,
    { inputs },
  );
  emit(detectMode(args.flags), `dispatched ${slug}\n  goal: ${out.goal_id}\n  run:  ${out.run_id}`);
  return 0;
}
