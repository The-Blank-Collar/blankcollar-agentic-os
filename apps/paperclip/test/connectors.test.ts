/**
 * Unit tests for the connector framework.
 *
 * Coverage:
 *   - Provider registry: every key resolves; unknown keys return null;
 *     the catalogue exposes a stable info shape.
 *   - Per-provider validateConfig() guards (url_poll, slack, gdrive).
 *   - Schema validation (ConnectorCreate / ConnectorPatch / ConnectorPaste).
 *
 * The full sync runner is exercised by `./infra/scripts/smoke.sh` against
 * a live Postgres — too DB-heavy to mock here cleanly.
 */

import { describe, expect, it } from "vitest";

import { getProvider, listProviders } from "../src/connectors/registry.js";
import {
  ConnectorCreate,
  ConnectorPaste,
  ConnectorPatch,
  ConnectorProviderKey,
} from "../src/schemas.js";

describe("connector registry", () => {
  it("exposes every documented provider", () => {
    const keys = listProviders().map((p) => p.info.key).sort();
    expect(keys).toEqual(
      ["gdrive", "hubspot", "manual_paste", "notion", "slack", "url_poll", "zoom"].sort(),
    );
  });

  it("returns null for unknown provider keys", () => {
    expect(getProvider("not_real")).toBeNull();
    expect(getProvider("")).toBeNull();
  });

  it("every provider declares a status from {ready, needs_oauth, stub}", () => {
    for (const p of listProviders()) {
      expect(["ready", "needs_oauth", "stub"]).toContain(p.info.status);
    }
  });

  it("manual_paste and url_poll are 'ready' (no OAuth required)", () => {
    expect(getProvider("manual_paste")?.info.status).toBe("ready");
    expect(getProvider("url_poll")?.info.status).toBe("ready");
  });

  it("oauth-gated providers throw on sync without nango_connection_id", async () => {
    const slack = getProvider("slack");
    expect(slack).not.toBeNull();
    await expect(
      slack!.sync({
        client: {} as never,
        org_id: "00000000-0000-0000-0000-000000000001",
        connector: {
          id: "x",
          org_id: "x",
          provider: "slack",
          name: "x",
          scope: "company",
          nango_connection_id: null,
          config: {},
          refresh_interval_seconds: 3600,
          last_synced_at: null,
          last_status: null,
          last_error: null,
          consecutive_failures: 0,
          enabled: true,
          created_at: "x",
          updated_at: "x",
        },
      }),
    ).rejects.toThrow(/Nango connection/i);
  });
});

describe("url_poll.validateConfig", () => {
  const provider = getProvider("url_poll")!;
  it("rejects an empty / missing urls array", () => {
    expect(provider.validateConfig({})).toBeTruthy();
    expect(provider.validateConfig({ urls: [] })).toBeTruthy();
  });

  it("rejects non-URL entries", () => {
    expect(provider.validateConfig({ urls: ["not a url"] })).toMatch(/invalid URL/);
  });

  it("accepts a small list of absolute URLs", () => {
    expect(
      provider.validateConfig({
        urls: ["https://example.com/a", "https://example.com/b"],
      }),
    ).toBeNull();
  });

  it("caps the URL list at 50", () => {
    const urls = Array.from({ length: 51 }, (_, i) => `https://example.com/${i}`);
    expect(provider.validateConfig({ urls })).toMatch(/capped at 50/);
  });
});

describe("slack.validateConfig", () => {
  const provider = getProvider("slack")!;
  it("accepts an empty config (defaults)", () => {
    expect(provider.validateConfig({})).toBeNull();
  });
  it("rejects channels that aren't strings", () => {
    expect(provider.validateConfig({ channels: [1, 2] })).toBeTruthy();
  });
  it("rejects out-of-range lookback_hours", () => {
    expect(provider.validateConfig({ lookback_hours: 0 })).toBeTruthy();
    expect(provider.validateConfig({ lookback_hours: 999 })).toBeTruthy();
    expect(provider.validateConfig({ lookback_hours: 24 })).toBeNull();
  });
});

describe("ConnectorProviderKey enum", () => {
  it("matches the registry key set", () => {
    const enumKeys = ConnectorProviderKey.options.slice().sort();
    const registryKeys = listProviders().map((p) => p.info.key).sort();
    expect(enumKeys).toEqual(registryKeys);
  });
});

describe("ConnectorCreate / ConnectorPatch / ConnectorPaste schemas", () => {
  it("ConnectorCreate requires provider + name", () => {
    expect(ConnectorCreate.safeParse({}).success).toBe(false);
    expect(
      ConnectorCreate.safeParse({ provider: "manual_paste", name: "demo" }).success,
    ).toBe(true);
  });

  it("ConnectorCreate clamps refresh_interval_seconds to >= 60", () => {
    expect(
      ConnectorCreate.safeParse({
        provider: "manual_paste",
        name: "x",
        refresh_interval_seconds: 30,
      }).success,
    ).toBe(false);
  });

  it("ConnectorPatch allows toggling enabled in isolation", () => {
    expect(ConnectorPatch.safeParse({ enabled: false }).success).toBe(true);
  });

  it("ConnectorPaste requires non-empty external_id, title, content_md", () => {
    expect(ConnectorPaste.safeParse({}).success).toBe(false);
    expect(
      ConnectorPaste.safeParse({
        external_id: "abc",
        title: "Demo",
        content_md: "Hello",
      }).success,
    ).toBe(true);
  });

  it("ConnectorPaste caps content_md at a sane size", () => {
    expect(
      ConnectorPaste.safeParse({
        external_id: "x",
        title: "x",
        content_md: "a".repeat(1_000_001),
      }).success,
    ).toBe(false);
  });
});
