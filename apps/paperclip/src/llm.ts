/**
 * Brand-voice loader + `narrate()` helper for synchronous prose paths
 * (briefings, capture classifier).
 *
 * The actual LLM call lives in `llm/gateway.ts` — this module is a thin
 * convenience around it that prepends our brand voice and standard
 * editorial guardrails to the system prompt. Errors swallow to null so
 * callers always have a templated fallback path; the gateway logs and
 * surfaces traces upstream.
 *
 * Every successful or failed call is also written to `ops.llm_call_log`
 * via `recordLlmCall()` when the caller passes a context — that's what
 * powers `bc llm` and the dashboard's cost/latency views.
 *
 * Hermes still owns the agent loop with its own (Portkey-routed) client.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";
import { chatComplete, GatewayError } from "./llm/gateway.js";
import { recordLlmCall } from "./llm/log.js";

let cachedBrand: string | null | undefined;

export async function loadBrandVoice(): Promise<string | null> {
  if (cachedBrand !== undefined) return cachedBrand;
  try {
    const file = path.join(config.brandDir, `${config.brandName}.md`);
    cachedBrand = await readFile(file, "utf8");
    return cachedBrand;
  } catch {
    cachedBrand = null;
    return null;
  }
}

export type NarrateContext = {
  orgId: string | null;
  runId?: string | null;
  provider?: "anthropic" | "openrouter";
};

export type NarrateInput = {
  systemHint?: string;
  userPrompt: string;
  context?: NarrateContext;
};

/**
 * Returns null when the gateway call fails — callers must always have
 * a templated fallback path. Hard configuration errors (PORTKEY_*) are
 * caught at boot by requireConfig(), so a null here means a transient
 * failure (rate limit, upstream 5xx, network) that the templated path
 * should cover.
 *
 * When `context` is supplied, every call (success or failure) is
 * recorded to ops.llm_call_log for cost/latency observability.
 */
export async function narrate(input: NarrateInput): Promise<string | null> {
  const brand = await loadBrandVoice();
  const systemParts: string[] = [];
  if (brand) {
    systemParts.push("Brand voice (apply when writing user-facing copy):", brand);
  }
  if (input.systemHint) systemParts.push(input.systemHint);
  systemParts.push(
    "Write tight, editorial prose. No business-speak. No bullet headers unless asked.",
    "Never invent facts beyond what the input explicitly states.",
  );
  const system = systemParts.join("\n\n");

  const provider = input.context?.provider ?? "anthropic";
  const start = Date.now();
  try {
    const result = await chatComplete({
      system,
      messages: [{ role: "user", content: input.userPrompt }],
      provider,
    });
    if (input.context) {
      await recordLlmCall({
        orgId: input.context.orgId,
        runId: input.context.runId ?? null,
        provider,
        model: result.model,
        tokensIn: result.usage.input_tokens,
        tokensOut: result.usage.output_tokens,
        latencyMs: Date.now() - start,
        status: "ok",
        traceId: result.trace_id,
      });
    }
    return result.text || null;
  } catch (err) {
    if (input.context) {
      await recordLlmCall({
        orgId: input.context.orgId,
        runId: input.context.runId ?? null,
        provider,
        model: config.llmModel,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - start,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        traceId: err instanceof GatewayError ? null : null,
      });
    }
    if (err instanceof GatewayError) return null;
    return null;
  }
}
