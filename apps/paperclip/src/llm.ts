/**
 * Thin Anthropic Messages client + brand-voice loader.
 *
 * Only used for synchronous prose generation (briefings). Hermes still owns
 * the agent loop — it has its own Anthropic client, brand voice loading,
 * and recall integration. This is a *side door* for "render this structured
 * input as editorial copy in our voice," nothing more.
 *
 * No SDK — one fetch call. Falls back to null when no API key, so callers
 * can ship a templated path for offline / unconfigured installs.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";

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
 * Returns null when no API key is configured or the call fails — callers
 * must always have a templated fallback path.
 */
export async function narrate(input: NarrateInput): Promise<string | null> {
  if (!config.anthropicApiKey) return null;

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
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: config.anthropicMaxTokens,
        system,
        messages: [{ role: "user", content: input.userPrompt }],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (body.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}
