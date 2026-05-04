import { createApiClient, type ApiClient } from "@blankcollar/shared/api-client";

import { getCurrentAccessToken, isAuthEnabled } from "./auth";

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
  // In auth mode, the org is derived from the verified user's account
  // server-side — the `X-BC-Org-Slug` header is only used in demo mode
  // to pick which seeded org to scope to.
  if (isAuthEnabled) return undefined;
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_DEFAULT_ORG_SLUG?.trim() || undefined;
}

export const api: ApiClient = createApiClient({
  baseUrl: resolveBaseUrl(),
  orgSlug: resolveOrgSlug(),
  getAuthToken: () => (isAuthEnabled ? getCurrentAccessToken() : null),
});
