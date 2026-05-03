/**
 * url_poll — fetch a list of public URLs on a schedule. Each URL becomes
 * one artifact; the artifact body is the response text (HTML→text via
 * the existing fetcher's lightweight stripper).
 *
 * Distinct from `ops.upstream_source` (Phase 2.5) which holds ONE sliding
 * document per URL. A single connector here can hold many URLs, and each
 * URL gets its own artifact + document. Useful for "this small set of
 * pages defines what we know about X" patterns.
 *
 * Config:
 *   {
 *     "urls": ["https://…", "https://…"]
 *   }
 *
 * No OAuth — works without Nango.
 */

import type { ConnectorProvider, ProviderArtifact } from "../types.js";

import { fetchExternalUrl, FetchExternalError } from "../../documents/fetch.js";

export const urlPollProvider: ConnectorProvider = {
  info: {
    key: "url_poll",
    label: "URL poll",
    hint: "Re-fetch a small set of public URLs on a schedule. No OAuth.",
    status: "ready",
    config_schema: {
      type: "object",
      required: ["urls"],
      properties: {
        urls: {
          type: "array",
          items: { type: "string", format: "uri" },
          description: "Absolute URLs to poll on each sync.",
          minItems: 1,
          maxItems: 50,
        },
      },
    },
  },

  validateConfig(config) {
    const urls = (config as { urls?: unknown }).urls;
    if (!Array.isArray(urls) || urls.length === 0) {
      return "config.urls must be a non-empty array of strings";
    }
    if (urls.length > 50) return "config.urls is capped at 50 entries per connector";
    for (const u of urls) {
      if (typeof u !== "string") return "config.urls entries must be strings";
      try {
        new URL(u);
      } catch {
        return `invalid URL: ${u.slice(0, 80)}`;
      }
    }
    return null;
  },

  async sync({ connector }) {
    const urls = (connector.config as { urls?: string[] }).urls ?? [];
    const out: ProviderArtifact[] = [];
    const warnings: string[] = [];
    for (const url of urls) {
      try {
        const result = await fetchExternalUrl(url);
        out.push({
          external_id: url,
          title: result.title || deriveTitle(url, result.text),
          content_md: result.text,
          metadata: { url, mime: result.mime, final_url: result.final_url },
          tags: ["url_poll"],
        });
      } catch (err) {
        // Per-URL failure shouldn't fail the whole sync; record + continue.
        if (err instanceof FetchExternalError) {
          warnings.push(`fetch failed for ${url}: ${err.message}`);
        } else {
          warnings.push(`fetch failed for ${url}: ${(err as Error).message ?? "unknown error"}`);
        }
      }
    }
    if (warnings.length > 0 && out.length === 0) {
      // Whole sync produced nothing — surface as an error so the operator
      // notices.
      throw new Error(warnings.join("; "));
    }
    return out;
  },
};

function deriveTitle(url: string, body: string): string {
  // First try the document's first H1 / first non-empty line.
  for (const raw of body.split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith("# ")) return t.replace(/^#+\s*/, "").slice(0, 200);
    return t.slice(0, 200);
  }
  // Fall back to the URL's last path segment.
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop() ?? u.hostname;
    return seg.slice(0, 200);
  } catch {
    return url.slice(0, 200);
  }
}
