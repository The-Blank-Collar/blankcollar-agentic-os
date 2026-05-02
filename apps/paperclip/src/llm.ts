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
 * Hermes still owns the agent loop with its own (Portkey-routed) client.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";
import { chatComplete, GatewayError } from "./llm/gateway.js";

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

export type NarrateInput = {
  systemHint?: string;
  userPrompt: string;
};

/**
 * Returns null when the gateway call fails — callers must always have
 * a templated fallback path. Hard configuration errors (PORTKEY_*) are
 * caught at boot by requireConfig(), so a null here means a transient
 * failure (rate limit, upstream 5xx, network) that the templated path
 * should cover.
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

  try {
    const result = await chatComplete({
      system,
      messages: [{ role: "user", content: input.userPrompt }],
    });
    return result.text || null;
  } catch (err) {
    // GatewayError on transient upstream failures → null so the caller
    // renders the templated path. Anything else also degrades to null
    // (we never want a briefing endpoint to 500 on LLM trouble).
    if (err instanceof GatewayError) return null;
    return null;
  }
}
