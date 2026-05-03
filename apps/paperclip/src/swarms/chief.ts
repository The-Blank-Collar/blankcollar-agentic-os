/**
 * Chief of Staff — decompose a goal into a DAG of subtasks.
 *
 * Routes through Portkey (`chatComplete`) when configured, falls back to
 * a deterministic decomposer (single-subtask plan = the whole goal as
 * one step) when keys are absent. The contract:
 *
 *   input  : goal title + description + the org's available skills
 *   output : ordered list of subtasks with depends_on edges (uuid-free —
 *            the route handler synthesises ids on insert)
 *
 * Why server-side LLM and not in LangGraph: the Chief picks the SHAPE of
 * the work (parallel fan-out, dependencies). LangGraph runs each leaf
 * once it's been picked. Keeping the Chief in paperclip keeps the DAG
 * planning + the tenant scoping in one place; LangGraph stays a
 * stateless executor.
 *
 * LLM-agnostic: every prompt routes through Portkey. The fallback path
 * is pure markdown / heuristic — no network, no keys.
 *
 * Backward compat: this function is purely additive; goals that don't
 * call `POST /api/goals/:id/plan-swarm` keep their existing flat-plan
 * lifecycle in `ops.goal.metadata.plan`.
 */

import { chatComplete, GatewayError } from "../llm/gateway.js";
import { config } from "../config.js";

export type ChiefStep = {
  /** 1-based step number (sequence in the input list, NOT the DAG order). */
  ordinal: number;
  title: string;
  instruction: string;
  /** 'hermes' for reasoning/writing, 'openclaw' for tool-use. */
  agent_kind: string;
  /** Optional skill slug from the registry; null when no good match. */
  skill_slug: string | null;
  /**
   * 1-based references to OTHER ordinals in the same plan that must
   * complete before this step. Empty = no deps (parallel start).
   */
  depends_on_ordinals: number[];
};

export type ChiefPlan = {
  steps: ChiefStep[];
  warnings: string[];
  llm_provider: string | null;
  llm_model: string | null;
};

export type ChiefInput = {
  title: string;
  description?: string | null;
  /** The org's available skill catalogue — grounds skill_slug picks. */
  registry?: { slug: string; agent_kind: string; description?: string | null }[];
};

const SYSTEM_PROMPT = `You are the Chief of Staff of an AI-native company. You decompose goals into a SHORT plan of concrete steps, expressing parallelism as dependencies.

Hard rules:
  - Output JSON only. No prose, no markdown fences, no explanations.
  - Keep the plan small (3..8 steps for most goals). Bigger plans are an anti-pattern at this stage.
  - Express PARALLELISM by leaving depends_on_ordinals empty for steps that can run independently. Express DEPENDENCY by listing the predecessor's ordinal.
  - Every depends_on entry MUST refer to a smaller ordinal in the same plan (DAG, not graph).
  - 'agent_kind' is 'hermes' for reasoning / writing / decision drafting, 'openclaw' for tool-use / web / external API.
  - 'skill_slug' MUST be one of the supplied registry entries, or null if no good match. Never invent.

JSON shape:
{
  "steps": [
    {
      "ordinal": 1,
      "title": "Short verb-first title",
      "instruction": "What to do, in 1-3 sentences, written for the agent.",
      "agent_kind": "hermes" | "openclaw",
      "skill_slug": null | "registry_slug",
      "depends_on_ordinals": []
    }
  ]
}`;

export async function chiefDecompose(input: ChiefInput): Promise<ChiefPlan> {
  const portkeyConfigured =
    !!config.portkeyApiKey && !!config.portkeyVirtualKeyAnthropic;

  if (!portkeyConfigured) {
    return fallbackDecompose(input);
  }

  const userPayload =
    `# Available skills\n\n` +
    (input.registry && input.registry.length > 0
      ? input.registry
          .slice(0, 60)
          .map(
            (s) =>
              `- \`${s.slug}\` (agent_kind=${s.agent_kind})` +
              (s.description ? ` — ${s.description}` : ""),
          )
          .join("\n")
      : "_(none — leave skill_slug null)_") +
    `\n\n# Goal\n\nTitle: ${input.title}\n` +
    (input.description ? `\nDescription:\n${input.description}\n` : "");

  let parsed: unknown;
  let model = (config as { llmModel?: string }).llmModel ?? "claude-sonnet-4-6";
  try {
    const resp = await chatComplete({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPayload }],
      max_tokens: 1500,
    });
    model = resp.model;
    parsed = parseLooseJson(resp.text);
  } catch (err) {
    if (err instanceof GatewayError) {
      const fb = fallbackDecompose(input);
      fb.warnings.unshift(`Chief LLM failed (${err.message}); used deterministic fallback.`);
      return { ...fb, llm_provider: "portkey", llm_model: model };
    }
    throw err;
  }

  const sanitized = sanitiseChiefPlan(parsed, input);
  return { ...sanitized, llm_provider: "portkey", llm_model: model };
}

// -- helpers ---------------------------------------------------------------

function parseLooseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fenceMatch ? fenceMatch[1]! : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const VALID_AGENT_KIND = /^[a-z][a-z0-9_-]{0,40}$/;

export function sanitiseChiefPlan(raw: unknown, input: ChiefInput): {
  steps: ChiefStep[];
  warnings: string[];
} {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const warnings: string[] = [];

  const stepsRaw = Array.isArray(obj.steps) ? (obj.steps as unknown[]) : [];
  if (stepsRaw.length === 0) {
    warnings.push("Chief returned no steps; using single-step fallback.");
    return {
      steps: [
        {
          ordinal: 1,
          title: input.title.slice(0, 200),
          instruction:
            (input.description ?? input.title).slice(0, 1_000) || input.title,
          agent_kind: "hermes",
          skill_slug: null,
          depends_on_ordinals: [],
        },
      ],
      warnings,
    };
  }

  const known = new Set((input.registry ?? []).map((s) => s.slug));
  const steps: ChiefStep[] = [];
  let nextOrdinal = 1;
  for (const s of stepsRaw.slice(0, 12)) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const title = stringField(o.title, "").trim();
    const instruction = stringField(o.instruction, "").trim();
    if (!title || !instruction) continue;

    const agentKindRaw = stringField(o.agent_kind, "hermes").trim();
    const agent_kind = VALID_AGENT_KIND.test(agentKindRaw) ? agentKindRaw : "hermes";

    let skill_slug = stringField(o.skill_slug, "").trim() || null;
    if (skill_slug && !known.has(skill_slug)) {
      warnings.push(`Step "${title}" referenced unknown skill "${skill_slug}"; cleared.`);
      skill_slug = null;
    }

    const depsRaw = Array.isArray(o.depends_on_ordinals)
      ? (o.depends_on_ordinals as unknown[])
      : [];
    const ordinal = nextOrdinal++;
    const depends_on_ordinals: number[] = [];
    for (const d of depsRaw) {
      const n = typeof d === "number" ? Math.floor(d) : NaN;
      if (Number.isFinite(n) && n >= 1 && n < ordinal) {
        depends_on_ordinals.push(n);
      } else if (Number.isFinite(n)) {
        warnings.push(`Step ${ordinal} referenced invalid dep ${n}; dropped.`);
      }
    }

    steps.push({
      ordinal,
      title: title.slice(0, 200),
      instruction: instruction.slice(0, 1_000),
      agent_kind,
      skill_slug,
      depends_on_ordinals: Array.from(new Set(depends_on_ordinals)),
    });
  }
  return { steps, warnings };
}

function stringField(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Deterministic fallback: a single linear plan whose only step is "do
 * the goal." Useful when Portkey is missing OR when the operator wants
 * the swarm dispatcher to drive a flat plan without any DAG structure.
 */
export function fallbackDecompose(input: ChiefInput): ChiefPlan {
  return {
    steps: [
      {
        ordinal: 1,
        title: input.title.slice(0, 200),
        instruction:
          (input.description ?? input.title).slice(0, 1_000) || input.title,
        agent_kind: "hermes",
        skill_slug: null,
        depends_on_ordinals: [],
      },
    ],
    warnings: [
      "Chief LLM not configured (Portkey keys missing) — single-step fallback. Configure PORTKEY_API_KEY to get a real DAG decomposition.",
    ],
    llm_provider: null,
    llm_model: null,
  };
}
