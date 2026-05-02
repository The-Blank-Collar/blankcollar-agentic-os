import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIG_ENV = { ...process.env };

describe("requireConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIG_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("throws when PORTKEY_API_KEY is missing", async () => {
    delete process.env.PORTKEY_API_KEY;
    process.env.PORTKEY_VIRTUAL_KEY_ANTHROPIC = "vk-test";
    const { requireConfig } = await import("../src/config.js");
    expect(() => requireConfig()).toThrowError(/PORTKEY_API_KEY/);
  });

  it("throws when PORTKEY_VIRTUAL_KEY_ANTHROPIC is missing", async () => {
    process.env.PORTKEY_API_KEY = "pk-test";
    delete process.env.PORTKEY_VIRTUAL_KEY_ANTHROPIC;
    const { requireConfig } = await import("../src/config.js");
    expect(() => requireConfig()).toThrowError(/PORTKEY_VIRTUAL_KEY_ANTHROPIC/);
  });

  it("lists all missing keys in a single error", async () => {
    delete process.env.PORTKEY_API_KEY;
    delete process.env.PORTKEY_VIRTUAL_KEY_ANTHROPIC;
    const { requireConfig } = await import("../src/config.js");
    expect(() => requireConfig()).toThrowError(/PORTKEY_API_KEY.*PORTKEY_VIRTUAL_KEY_ANTHROPIC/s);
  });

  it("succeeds when all required env vars are set", async () => {
    process.env.PORTKEY_API_KEY = "pk-test";
    process.env.PORTKEY_VIRTUAL_KEY_ANTHROPIC = "vk-test";
    const { requireConfig } = await import("../src/config.js");
    expect(() => requireConfig()).not.toThrow();
  });
});
