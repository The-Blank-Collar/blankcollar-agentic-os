/**
 * AI gateway — single chokepoint for every LLM call paperclip makes.
 *
 * Why Portkey: one place to see latency / cost / errors across the whole
 * stack, one place to swap providers, one place to rotate keys. Every
 * synchronous prose path (briefings, classifier, future agents) goes
 * through `chatComplete`.
 *
 * The wire format is Anthropic's Messages API — Portkey is configured to
 * passthrough Anthropic-shaped payloads to the provider referenced by the
 * virtual key. We never speak OpenAI-shaped JSON here even though the
 * gateway supports it.
 *
 * Boot guard: `requireConfig()` (in config.ts) throws if PORTKEY_API_KEY
 * or PORTKEY_VIRTUAL_KEY_ANTHROPIC are unset, so by the time this module
 * is reached the keys are guaranteed present. The defensive check below
 * is a belt-and-suspenders for unit tests / programmatic boots.
 */

import { config } from "../config.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatCompleteInput = {
  system?: string;
  messages: ChatMessage[];
  model?: string;
  max_tokens?: number;
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

export type ChatCompleteOptions = {
  fetchImpl?: typeof fetch;
};

export async function chatComplete(
  input: ChatCompleteInput,
  opts: ChatCompleteOptions = {},
): Promise<ChatCompleteResult> {
  if (!config.portkeyApiKey || !config.portkeyVirtualKeyAnthropic) {
    throw new GatewayError(
      0,
      null,
      "PORTKEY_API_KEY and PORTKEY_VIRTUAL_KEY_ANTHROPIC must be set " +
        "before any LLM call. Did boot skip requireConfig()?",
    );
  }

  const url = `${config.portkeyBaseUrl.replace(/\/$/, "")}/messages`;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const body = {
    model: input.model ?? config.llmModel,
    max_tokens: input.max_tokens ?? config.llmMaxTokens,
    ...(input.system ? { system: input.system } : {}),
    messages: input.messages,
  };

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-portkey-api-key": config.portkeyApiKey,
      "x-portkey-virtual-key": config.portkeyVirtualKeyAnthropic,
      // Anthropic's wire requires this; Portkey forwards it through.
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
