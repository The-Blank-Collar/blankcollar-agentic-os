/** Env-driven configuration. Mirrors `.env.example`. */

const env = process.env;

export const config = {
  env: env.ENV ?? "local",
  logLevel: env.LOG_LEVEL ?? "info",
  port: Number(env.PAPERCLIP_INTERNAL_PORT ?? 80),

  databaseUrl:
    env.DATABASE_URL ?? "postgresql://postgres:postgres@postgres:5432/blankcollar",

  gbrainUrl: env.GBRAIN_URL ?? "http://gbrain:80",

  /**
   * Phase 0–5: no real auth yet. Every request resolves to the demo org's owner.
   * Replace with JWT-derived scope in Phase 6.
   */
  defaultOrgSlug: env.PAPERCLIP_DEFAULT_ORG_SLUG ?? "blankcollar-demo",

  workerPollIntervalMs: Number(env.PAPERCLIP_WORKER_POLL_MS ?? 1500),
  workerEnabled: env.PAPERCLIP_WORKER_ENABLED !== "false",

  /**
   * Supabase auth — Phase 6 prep.
   * When `supabaseJwtSecret` is set, incoming Authorization: Bearer <jwt>
   * tokens are verified and the request scope is derived from the verified
   * user. When unset, every request resolves to the demo org's owner (today's
   * behaviour). Enforcement (i.e. "401 when no token") is OFF in v0 — the
   * middleware silently degrades so existing flows keep working.
   */
  supabaseJwtSecret: env.SUPABASE_JWT_SECRET ?? "",
  supabaseProjectUrl: env.SUPABASE_URL ?? "",
  authEnforce: env.PAPERCLIP_AUTH_ENFORCE === "true",

  /**
   * AI gateway — Portkey routes every LLM call through a single observable
   * proxy. PORTKEY_API_KEY + PORTKEY_VIRTUAL_KEY_ANTHROPIC are required at
   * boot (see requireConfig()); the legacy ANTHROPIC_API_KEY is no longer
   * read at runtime — Anthropic credentials live in the Portkey dashboard,
   * referenced by the virtual key.
   */
  portkeyApiKey: env.PORTKEY_API_KEY ?? "",
  portkeyVirtualKeyAnthropic: env.PORTKEY_VIRTUAL_KEY_ANTHROPIC ?? "",
  // Optional second virtual key — Portkey can route requests to OpenRouter,
  // which exposes hundreds of models (Llama, Mistral, Gemini, …) behind a
  // single API. Default callers use the Anthropic VK; pass `virtualKey`
  // to chatComplete() to route a specific call through OpenRouter instead.
  portkeyVirtualKeyOpenRouter: env.PORTKEY_VIRTUAL_KEY_OPENROUTER ?? "",
  portkeyBaseUrl: env.PORTKEY_BASE_URL ?? "https://api.portkey.ai/v1",

  /**
   * Model + budget for the prose-generation side door (briefings, classifier).
   * Hermes still owns the agent loop with its own model selection.
   */
  llmModel: env.PAPERCLIP_LLM_MODEL ?? "claude-sonnet-4-6",
  llmMaxTokens: Number(env.PAPERCLIP_LLM_MAX_TOKENS ?? 800),
  brandDir: env.BRAND_DIR ?? "/app/brand",
  brandName: env.BRAND_NAME ?? "blankcollar",

  /** Routine scheduler — wakes periodically and fires due routines. */
  schedulerEnabled: env.PAPERCLIP_SCHEDULER_ENABLED !== "false",
  schedulerTickMs: Number(env.PAPERCLIP_SCHEDULER_TICK_MS ?? 60_000),

  /**
   * Phase 2.6 RLS strict flip. When true (the default), the RLS policy
   * `app_scope_org` on every tenant table requires `app.org_id` to be
   * bound — unscoped queries return zero rows and writes fail. When
   * false, the legacy "permissive on unset" branches stay in the
   * policies as a temporary escape hatch.
   *
   * Toggle via `PAPERCLIP_RLS_STRICT=false` if you need to revert
   * without redeploying after upgrading. New installs should leave it
   * at the default.
   */
  rlsStrict: env.PAPERCLIP_RLS_STRICT !== "false",

  /**
   * Auto-generate a daily briefing for each org once per day, at this UTC
   * hour. Single-user installs will want this in their timezone (8am local
   * = 13:00 UTC for ET, etc.). Per-user timezone settings land in Phase 6.
   */
  briefingHourUtc: Number(env.PAPERCLIP_BRIEFING_HOUR_UTC ?? 8),
} as const;

export type Config = typeof config;

/**
 * Soft validation at boot: warn loudly if Portkey isn't configured but
 * don't throw. The gateway transparently falls back to a FakeLLM that
 * returns canned responses, so a fresh clone can `make bootstrap` and
 * play with the stack before hooking up real LLM credentials.
 *
 * Set `PORTKEY_API_KEY` (and either a `@workspace/model` reference in
 * `PAPERCLIP_LLM_MODEL` or `PORTKEY_VIRTUAL_KEY_ANTHROPIC` for legacy
 * routing) to switch from FakeLLM to real Claude.
 *
 * Called from index.ts before any route is registered.
 */
export function requireConfig(): { fakeLlm: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const usingModelCatalog = config.llmModel.startsWith("@");
  if (!config.portkeyApiKey) {
    warnings.push(
      "PORTKEY_API_KEY is unset — running in FakeLLM mode. Real LLM calls " +
        "(briefings, classifier, Telegram, Hermes) will return canned text. " +
        "Set PORTKEY_API_KEY in .env to enable Claude.",
    );
  } else if (!usingModelCatalog && !config.portkeyVirtualKeyAnthropic) {
    warnings.push(
      "PORTKEY_API_KEY is set but PORTKEY_VIRTUAL_KEY_ANTHROPIC is not — " +
        "and PAPERCLIP_LLM_MODEL is a plain name (legacy routing). LLM " +
        "calls will fail until you either (a) set the virtual key OR (b) " +
        "switch PAPERCLIP_LLM_MODEL to a `@workspace/model` reference.",
    );
  }
  for (const w of warnings) {
    // eslint-disable-next-line no-console
    console.warn(`[config] ${w}`);
  }
  return { fakeLlm: !config.portkeyApiKey, warnings };
}
