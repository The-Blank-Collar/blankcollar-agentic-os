import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIG_ENV = { ...process.env };

describe("requireConfig (Phase S2.7 — soft validation)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIG_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  // Sprint S2.7 made Portkey OPTIONAL. requireConfig now warns + returns
  // a { fakeLlm, warnings } result instead of throwing, so OSS local
  // installs can `make bootstrap` without any API keys. The gateway
  // transparently falls back to FakeLLM.

  it("returns fakeLlm=true and a warning when PORTKEY_API_KEY is missing", async () => {
    delete process.env.PORTKEY_API_KEY;
    process.env.PORTKEY_VIRTUAL_KEY_ANTHROPIC = "vk-test";
    const { requireConfig } = await import("../src/config.js");
    const result = requireConfig();
    expect(result.fakeLlm).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/PORTKEY_API_KEY/);
  });

  it("warns when PORTKEY_API_KEY is set but legacy routing has no virtual key", async () => {
    process.env.PORTKEY_API_KEY = "pk-test";
    delete process.env.PORTKEY_VIRTUAL_KEY_ANTHROPIC;
    process.env.PAPERCLIP_LLM_MODEL = "claude-sonnet-4-6"; // plain name → legacy routing
    const { requireConfig } = await import("../src/config.js");
    const result = requireConfig();
    expect(result.fakeLlm).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/PORTKEY_VIRTUAL_KEY_ANTHROPIC/);
  });

  it("returns clean (no warnings) when Model Catalog routing is used with no VK", async () => {
    process.env.PORTKEY_API_KEY = "pk-test";
    delete process.env.PORTKEY_VIRTUAL_KEY_ANTHROPIC;
    // `@workspace/model` syntax means Portkey routes via Model Catalog,
    // which doesn't need the legacy virtual-key header.
    process.env.PAPERCLIP_LLM_MODEL = "@blankcollar/claude-sonnet-4-5-20250929";
    const { requireConfig } = await import("../src/config.js");
    const result = requireConfig();
    expect(result.fakeLlm).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("returns clean when both Portkey vars are set (legacy routing)", async () => {
    process.env.PORTKEY_API_KEY = "pk-test";
    process.env.PORTKEY_VIRTUAL_KEY_ANTHROPIC = "vk-test";
    process.env.PAPERCLIP_LLM_MODEL = "claude-sonnet-4-6";
    const { requireConfig } = await import("../src/config.js");
    const result = requireConfig();
    expect(result.fakeLlm).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});

describe("rlsStrict (Phase 2.6)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIG_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("defaults to strict when PAPERCLIP_RLS_STRICT is unset", async () => {
    delete process.env.PAPERCLIP_RLS_STRICT;
    const { config } = await import("../src/config.js");
    expect(config.rlsStrict).toBe(true);
  });

  it("defaults to strict when PAPERCLIP_RLS_STRICT is 'true'", async () => {
    process.env.PAPERCLIP_RLS_STRICT = "true";
    const { config } = await import("../src/config.js");
    expect(config.rlsStrict).toBe(true);
  });

  it("falls back to permissive only on explicit 'false'", async () => {
    process.env.PAPERCLIP_RLS_STRICT = "false";
    const { config } = await import("../src/config.js");
    expect(config.rlsStrict).toBe(false);
  });

  it("treats other values as strict (defensive default)", async () => {
    process.env.PAPERCLIP_RLS_STRICT = "0";
    const { config } = await import("../src/config.js");
    // "0" is not the literal string "false" — strict wins.
    expect(config.rlsStrict).toBe(true);
  });
});
