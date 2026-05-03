/**
 * AI gateway — single chokepoint for every LLM call paperclip makes.
 *
 * Why Portkey: one place to see latency / cost / errors across the whole
 * stack, one place to swap providers, one place to rotate keys. Every
 * synchronous prose path (briefings, classifier, future agents) goes
 * through `chatComplete`.
 *
 * Two routing styles supported (auto-detected from the model name):
 *
 *   1. Model Catalog (Portkey 2025+): model = `@workspace/model-id`
 *      → wire: OpenAI-shaped /chat/completions
 *      → headers: x-portkey-api-key only (no virtual-key header)
 *      The `@workspace` prefix carries the routing — Portkey reads it
 *      and dispatches to the workspace's configured provider+key. No
 *      separate virtual-key header is needed (and including one is
 *      a 400 from Portkey's side).
 *
 *   2. Legacy Virtual Key: model = plain name (e.g. `claude-sonnet-4-6`)
 *      → wire: Anthropic-shaped /messages
 *      → headers: x-portkey-api-key + x-portkey-virtual-key
 *      Used when the operator configured a classic Virtual Key in
 *      Portkey's older UI.
 *
 * Boot guard: `requireConfig()` (in config.ts) throws if PORTKEY_API_KEY
 * is unset. PORTKEY_VIRTUAL_KEY_ANTHROPIC is required only for the legacy
 * routing path; Model Catalog setups don't need it.
 */

import { config } from "../config.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatCompleteInput = {
  system?: string;
  messages: ChatMessage[];
  model?: string;
  max_tokens?: number;
  /**
   * Override the Portkey virtual key for this call. Only used by the
   * legacy Virtual Key routing path; Model Catalog requests ignore it.
   */
  provider?: "anthropic" | "openrouter";
};

export type ChatCompleteResult = {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  trace_id: string | null;
};

export class GatewayError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type AnthropicMessageResponse = {
  id?: string;
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

type OpenAIChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { role?: string; content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type ChatCompleteOptions = {
  fetchImpl?: typeof fetch;
};

/** True when the model identifier carries Portkey's `@workspace/model` routing. */
function isModelCatalogRef(model: string): boolean {
  return typeof model === "string" && model.startsWith("@");
}

export async function chatComplete(
  input: ChatCompleteInput,
  opts: ChatCompleteOptions = {},
): Promise<ChatCompleteResult> {
  if (!config.portkeyApiKey) {
    throw new GatewayError(
      0,
      null,
      "PORTKEY_API_KEY must be set before any LLM call. " +
        "Did boot skip requireConfig()?",
    );
  }

  const model = input.model ?? config.llmModel;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = config.portkeyBaseUrl.replace(/\/$/, "");

  // ── Model Catalog routing (preferred when `@workspace/...` is set) ─────
  if (isModelCatalogRef(model)) {
    const url = `${baseUrl}/chat/completions`;
    const messages = input.system
      ? [{ role: "system", content: input.system }, ...input.messages]
      : input.messages;
    const body = {
      model,
      max_tokens: input.max_tokens ?? config.llmMaxTokens,
      messages,
    };
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-portkey-api-key": config.portkeyApiKey,
      },
      body: JSON.stringify(body),
    });
    const traceId =
      res.headers.get("x-portkey-trace-id") ??
      res.headers.get("x-trace-id") ??
      null;
    const rawText = await res.text();
    let parsed: OpenAIChatResponse | { error?: { message?: string } } | null = null;
    try {
      parsed = rawText.length > 0 ? (JSON.parse(rawText) as OpenAIChatResponse) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const message =
        (parsed as { error?: { message?: string } } | null)?.error?.message ??
        `HTTP ${res.status} ${res.statusText}`;
      throw new GatewayError(res.status, parsed ?? rawText, `gateway: ${message}`);
    }
    const data = (parsed ?? {}) as OpenAIChatResponse;
    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    return {
      text,
      usage: {
        input_tokens: Number(data.usage?.prompt_tokens ?? 0),
        output_tokens: Number(data.usage?.completion_tokens ?? 0),
      },
      model: data.model ?? model,
      trace_id: traceId,
    };
  }

  // ── Legacy Virtual Key routing (Anthropic-shaped /messages) ────────────
  if (!config.portkeyVirtualKeyAnthropic) {
    throw new GatewayError(
      0,
      null,
      "Legacy Virtual Key routing requires PORTKEY_VIRTUAL_KEY_ANTHROPIC. " +
        "Either set it OR switch to a `@workspace/model` Model Catalog reference.",
    );
  }
  const provider = input.provider ?? "anthropic";
  const virtualKey =
    provider === "openrouter"
      ? config.portkeyVirtualKeyOpenRouter
      : config.portkeyVirtualKeyAnthropic;
  if (!virtualKey) {
    throw new GatewayError(
      0,
      null,
      `gateway: provider="${provider}" requested but no Portkey virtual ` +
        `key is configured for it. Set PORTKEY_VIRTUAL_KEY_${provider.toUpperCase()}.`,
    );
  }

  const url = `${baseUrl}/messages`;
  const body = {
    model,
    max_tokens: input.max_tokens ?? config.llmMaxTokens,
    ...(input.system ? { system: input.system } : {}),
    messages: input.messages,
  };

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-portkey-api-key": config.portkeyApiKey,
      "x-portkey-virtual-key": virtualKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  const traceId =
    res.headers.get("x-portkey-trace-id") ??
    res.headers.get("x-trace-id") ??
    null;

  const rawText = await res.text();
  let parsed: AnthropicMessageResponse | { error?: { message?: string } } | null = null;
  try {
    parsed = rawText.length > 0 ? (JSON.parse(rawText) as AnthropicMessageResponse) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const message =
      (parsed as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${res.status} ${res.statusText}`;
    throw new GatewayError(res.status, parsed ?? rawText, `gateway: ${message}`);
  }

  const data = (parsed ?? {}) as AnthropicMessageResponse;
  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return {
    text,
    usage: {
      input_tokens: Number(data.usage?.input_tokens ?? 0),
      output_tokens: Number(data.usage?.output_tokens ?? 0),
    },
    model: data.model ?? body.model,
    trace_id: traceId,
  };
}
