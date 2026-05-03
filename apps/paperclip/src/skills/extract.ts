/**
 * SOP → Skill extractor.
 *
 * Takes a markdown SOP/playbook + the org's known tool/skill registry and
 * returns a structured `SkillDraftFields` payload — title, description,
 * agent_kind, proposed_slug, ordered steps, inferred tool slugs, and
 * a JSON-Schema-shaped params_schema.
 *
 * Routing:
 *   - When Portkey is configured (PORTKEY_API_KEY + PORTKEY_VIRTUAL_KEY_ANTHROPIC),
 *     calls `chatComplete` from the gateway. The gateway is provider-agnostic
 *     (Anthropic / OpenRouter / FakeLLM in tests), so this code is too.
 *   - When Portkey is NOT configured (local dev, OSS demo) the heuristic
 *     fallback (`fallbackExtract`) parses the markdown deterministically:
 *     first H1 / line as the title, bullets as steps, no tool inference.
 *
 * The result lands in `ops.skill_draft`. The operator reviews + promotes
 * (Sprint 5.3 review UI lives in Settings → Skills); promotion writes to
 * `ops.skill` with `source_document_id` set.
 */

import { chatComplete, GatewayError } from "../llm/gateway.js";
import { config } from "../config.js";

export type SkillStep = {
  n: number;
  instruction: string;
  /** Optional skill / tool slug from the registry that implements this step. */
  tool: string | null;
};

export type SkillDraftFields = {
  title: string;
  description: string;
  agent_kind: "hermes" | "openclaw" | string;
  proposed_slug: string;
  steps: SkillStep[];
  inferred_tools: string[];
  params_schema: Record<string, unknown>;
  warnings: string[];
};

export type ExtractInput = {
  /** The markdown SOP / playbook. */
  content_md: string;
  /** Optional title hint (the document's title from ops.document). */
  title_hint?: string;
  /**
   * Skills + tools the org already has. The extractor uses these to fill
   * `inferred_tools` — never inventing a slug that doesn't exist.
   */
  registry?: { slug: string; description?: string | null; agent_kind?: string }[];
};

export type ExtractResult = SkillDraftFields & {
  llm_provider: string | null;
  llm_model: string | null;
};

const SYSTEM_PROMPT = `You convert company SOPs (standard operating procedures) into executable AI skill drafts.

You receive:
  - The SOP as markdown.
  - A list of available tools / skills the company already has.

You return a single JSON object with these fields and no other text:
  {
    "title": string,           // 60 chars max — verb-first, action-oriented
    "description": string,     // one paragraph, what this skill achieves
    "agent_kind": string,      // 'hermes' for reasoning/writing, 'openclaw' for tool-use, or another kind if obvious
    "proposed_slug": string,   // dotted lowercase: 'category.action' (e.g. 'sales.draft_proposal')
    "steps": [
      { "n": 1, "instruction": "do X", "tool": "skill.slug or null" }
    ],
    "inferred_tools": [        // ONLY slugs from the registry. Never invent.
      "registry_skill_slug"
    ],
    "params_schema": {         // JSON-Schema-ish; what inputs would the operator provide
      "type": "object",
      "properties": { "input_name": { "type": "string", "description": "..." } },
      "required": []
    },
    "warnings": []             // anything ambiguous, plain English
  }

Hard rules:
  - Output JSON only. No prose, no markdown fences, no explanations.
  - 'inferred_tools' MUST come from the registry. If you can't find a match, leave the array empty.
  - 'proposed_slug' MUST be lowercase dotted: only [a-z0-9._-] characters.
  - Steps MUST be numbered starting at 1 and be ordered.
`;

export async function extractSkillDraft(input: ExtractInput): Promise<ExtractResult> {
  // Route through the LLM if Portkey is configured. Otherwise fall back to
  // deterministic markdown parsing so the demo + tests run with no keys.
  const portkeyConfigured =
    !!config.portkeyApiKey && !!config.portkeyVirtualKeyAnthropic;

  if (!portkeyConfigured) {
    const stub = fallbackExtract(input);
    return { ...stub, llm_provider: null, llm_model: null };
  }

  const userPayload =
    `# Tools / skills already available to the company\n\n` +
    (input.registry && input.registry.length > 0
      ? input.registry
          .slice(0, 100)
          .map(
            (t) =>
              `- \`${t.slug}\`${t.agent_kind ? ` (agent_kind=${t.agent_kind})` : ""}` +
              (t.description ? ` — ${t.description}` : ""),
          )
          .join("\n")
      : "_(no tools registered — leave inferred_tools empty)_") +
    `\n\n# SOP\n\n${input.title_hint ? `Title hint: ${input.title_hint}\n\n` : ""}${input.content_md}`;

  let parsed: unknown;
  let model = (config as { llmModel?: string }).llmModel ?? "claude-sonnet-4-6";
  try {
    const resp = await chatComplete({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPayload }],
      max_tokens: 1200,
    });
    model = resp.model;
    parsed = parseLooseJson(resp.text);
  } catch (err) {
    if (err instanceof GatewayError) {
      // Provider failure → don't bubble up; fall back so the operator
      // gets *something* and can refine. Surface as a warning.
      const stub = fallbackExtract(input);
      stub.warnings.unshift(
        `LLM extraction failed (${err.message}); using deterministic fallback.`,
      );
      return { ...stub, llm_provider: "portkey", llm_model: model };
    }
    throw err;
  }

  const sanitized = sanitiseDraft(parsed, input);
  return { ...sanitized, llm_provider: "portkey", llm_model: model };
}

// -- helpers ---------------------------------------------------------------

function parseLooseJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip a markdown code fence if the model added one despite instructions.
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fenceMatch ? fenceMatch[1]! : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    // Find the first `{` and try parsing from there to the last `}`.
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

const SLUG_OK = /^[a-z0-9._-]+$/;

export function sanitiseDraft(raw: unknown, input: ExtractInput): SkillDraftFields {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const warnings: string[] = Array.isArray(obj.warnings)
    ? (obj.warnings as unknown[]).filter((w): w is string => typeof w === "string")
    : [];

  const title = stringField(obj.title, fallbackTitle(input)).slice(0, 200);
  const description = stringField(obj.description, "").slice(0, 5_000);
  const agentKindRaw = stringField(obj.agent_kind, "hermes").trim();
  const agent_kind = /^[a-z][a-z0-9_-]{0,40}$/.test(agentKindRaw) ? agentKindRaw : "hermes";

  let proposed_slug = stringField(obj.proposed_slug, "").trim().toLowerCase();
  if (!SLUG_OK.test(proposed_slug)) {
    const alt = slugify(title);
    if (proposed_slug) {
      warnings.push(`Slug "${proposed_slug}" rewritten to "${alt}" (only [a-z0-9._-] allowed).`);
    }
    proposed_slug = alt;
  }

  const stepsRaw = Array.isArray(obj.steps) ? (obj.steps as unknown[]) : [];
  const steps: SkillStep[] = stepsRaw
    .map((s, i) => {
      if (!s || typeof s !== "object") return null;
      const o = s as Record<string, unknown>;
      const n = typeof o.n === "number" ? o.n : i + 1;
      const instruction = stringField(o.instruction, "").trim();
      if (!instruction) return null;
      const tool = stringField(o.tool, "").trim() || null;
      return { n, instruction: instruction.slice(0, 1_000), tool };
    })
    .filter((s): s is SkillStep => s !== null);

  // Drop tools that aren't in the registry.
  const known = new Set((input.registry ?? []).map((t) => t.slug));
  const inferredRaw = Array.isArray(obj.inferred_tools)
    ? (obj.inferred_tools as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const inferred_tools = inferredRaw.filter((t) => known.has(t));
  const dropped = inferredRaw.filter((t) => !known.has(t));
  if (dropped.length > 0) {
    warnings.push(
      `Dropped ${dropped.length} inferred tool(s) not in the registry: ${dropped.slice(0, 5).join(", ")}.`,
    );
  }

  // Same filter for steps' tool field.
  for (const s of steps) {
    if (s.tool && !known.has(s.tool)) {
      warnings.push(`Step ${s.n} referenced unknown tool "${s.tool}"; cleared.`);
      s.tool = null;
    }
  }

  const params_schema =
    obj.params_schema && typeof obj.params_schema === "object"
      ? (obj.params_schema as Record<string, unknown>)
      : { type: "object", properties: {}, required: [] };

  return {
    title,
    description,
    agent_kind,
    proposed_slug,
    steps,
    inferred_tools,
    params_schema,
    warnings,
  };
}

function stringField(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function fallbackTitle(input: ExtractInput): string {
  if (input.title_hint && input.title_hint.trim()) return input.title_hint.trim();
  // First markdown H1 / H2 / first non-blank line.
  for (const raw of input.content_md.split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith("#")) return t.replace(/^#+\s*/, "").slice(0, 200);
    return t.slice(0, 200);
  }
  return "Untitled SOP";
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 80) || "skill.untitled"
  );
}

/**
 * Deterministic fallback used when Portkey isn't configured. Produces a
 * usable-but-rough draft so the demo / tests don't need network or keys.
 */
export function fallbackExtract(input: ExtractInput): SkillDraftFields {
  const title = fallbackTitle(input);
  const lines = input.content_md.split("\n");
  const steps: SkillStep[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^[-*+]\s+(.+)$/) || t.match(/^\d+\.\s+(.+)$/);
    if (!m) continue;
    steps.push({ n: steps.length + 1, instruction: m[1]!.slice(0, 1_000), tool: null });
  }
  return {
    title,
    description: title,
    agent_kind: "hermes",
    proposed_slug: slugify(title),
    steps,
    inferred_tools: [],
    params_schema: { type: "object", properties: {}, required: [] },
    warnings: [
      "LLM not configured (Portkey keys missing) — used deterministic markdown parsing.",
    ],
  };
}
