import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Portkey env must be set before the gateway module is imported (ESM
// hoists imports). We dynamically import inside each test so the
// already-loaded `config` snapshot from the surrounding test suite
// doesn't leak through.
const ORIG_ENV = { ...process.env };

beforeAll(() => {
  process.env.PORTKEY_API_KEY = "pk-test-12345";
  process.env.PORTKEY_VIRTUAL_KEY_ANTHROPIC = "vk-anth-test";
  process.env.PORTKEY_BASE_URL = "https://api.portkey.ai/v1";
  process.env.PAPERCLIP_LLM_MODEL = "claude-sonnet-4-6";
  process.env.PAPERCLIP_LLM_MAX_TOKENS = "800";
});
afterAll(() => {
  process.env = { ...ORIG_ENV };
});

type FetchSpy = ReturnType<typeof vi.fn<typeof fetch>>;

function makeFetch(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): FetchSpy {
  const headers = new Headers({
    "content-type": "application/json",
    ...extraHeaders,
  });
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers,
    text: async () => JSON.stringify(body),
  } as unknown as Response);
}

describe("chatComplete (Portkey gateway)", () => {
  it("sends Anthropic-shaped body to /messages with Portkey headers", async () => {
    const { chatComplete } = await import("../src/llm/gateway.js");
    const fetchImpl = makeFetch(
      {
        id: "msg_1",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "hello world" }],
        usage: { input_tokens: 12, output_tokens: 3 },
      },
      200,
      { "x-portkey-trace-id": "trc_abc" },
    );
    const out = await chatComplete(
      {
        system: "be brief",
        messages: [{ role: "user", content: "hi" }],
      },
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.portkey.ai/v1/messages");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-portkey-api-key"]).toBe("pk-test-12345");
    expect(headers["x-portkey-virtual-key"]).toBe("vk-anth-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["content-type"]).toBe("application/json");

    const sent = JSON.parse(String(init?.body));
    expect(sent.model).toBe("claude-sonnet-4-6");
    expect(sent.max_tokens).toBe(800);
    expect(sent.system).toBe("be brief");
    expect(sent.messages).toEqual([{ role: "user", content: "hi" }]);

    expect(out.text).toBe("hello world");
    expect(out.usage).toEqual({ input_tokens: 12, output_tokens: 3 });
    expect(out.model).toBe("claude-sonnet-4-6");
    expect(out.trace_id).toBe("trc_abc");
  });

  it("omits the system field when input.system is unset", async () => {
    const { chatComplete } = await import("../src/llm/gateway.js");
    const fetchImpl = makeFetch({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await chatComplete({ messages: [{ role: "user", content: "hi" }] }, { fetchImpl });
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect("system" in sent).toBe(false);
  });

  it("respects per-call model + max_tokens overrides", async () => {
    const { chatComplete } = await import("../src/llm/gateway.js");
    const fetchImpl = makeFetch({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await chatComplete(
      {
        messages: [{ role: "user", content: "hi" }],
        model: "claude-haiku-4-5",
        max_tokens: 50,
      },
      { fetchImpl },
    );
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(sent.model).toBe("claude-haiku-4-5");
    expect(sent.max_tokens).toBe(50);
  });

  it("throws GatewayError on a 4xx response with the upstream message", async () => {
    const { chatComplete, GatewayError } = await import("../src/llm/gateway.js");
    const fetchImpl = makeFetch({ error: { message: "rate limited" } }, 429);
    await expect(
      chatComplete({ messages: [{ role: "user", content: "hi" }] }, { fetchImpl }),
    ).rejects.toMatchObject({
      constructor: GatewayError,
      status: 429,
      message: expect.stringContaining("rate limited"),
    });
  });

  it("throws GatewayError on a 5xx response", async () => {
    const { chatComplete, GatewayError } = await import("../src/llm/gateway.js");
    const fetchImpl = makeFetch({}, 503);
    await expect(
      chatComplete({ messages: [{ role: "user", content: "hi" }] }, { fetchImpl }),
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it("returns empty text when content array is empty (degraded but non-fatal)", async () => {
    const { chatComplete } = await import("../src/llm/gateway.js");
    const fetchImpl = makeFetch({
      content: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const out = await chatComplete(
      { messages: [{ role: "user", content: "hi" }] },
      { fetchImpl },
    );
    expect(out.text).toBe("");
  });

  it("falls back to x-trace-id when x-portkey-trace-id is absent", async () => {
    const { chatComplete } = await import("../src/llm/gateway.js");
    const fetchImpl = makeFetch(
      { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } },
      200,
      { "x-trace-id": "fallback-id" },
    );
    const out = await chatComplete(
      { messages: [{ role: "user", content: "hi" }] },
      { fetchImpl },
    );
    expect(out.trace_id).toBe("fallback-id");
  });
});
