import { createApiClient, type ApiClient } from "@blankcollar/shared/api-client";

/**
 * Resolve the Paperclip base URL from build-time env (Vite injects
 * `import.meta.env.VITE_*` at build). Defaults to localhost:3001 — the new
 * port for the API after the website claimed `:3000`.
 */
function resolveBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_PAPERCLIP_URL ?? "http://localhost:3001";
}

function resolveOrgSlug(): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_DEFAULT_ORG_SLUG?.trim() || undefined;
}

export const api: ApiClient = createApiClient({
  baseUrl: resolveBaseUrl(),
  orgSlug: resolveOrgSlug(),
});
