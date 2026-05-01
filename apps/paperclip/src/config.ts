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
   * Direct LLM access for prose generation (briefings, plan synthesis).
   * Stays empty by default — when unset, briefings render via the templated
   * fallback so the demo runs offline. Hermes still owns the agent loop.
   */
  anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: env.PAPERCLIP_LLM_MODEL ?? "claude-sonnet-4-6",
  anthropicMaxTokens: Number(env.PAPERCLIP_LLM_MAX_TOKENS ?? 800),
  brandDir: env.BRAND_DIR ?? "/app/brand",
  brandName: env.BRAND_NAME ?? "blankcollar",

  /** Routine scheduler — wakes periodically and fires due routines. */
  schedulerEnabled: env.PAPERCLIP_SCHEDULER_ENABLED !== "false",
  schedulerTickMs: Number(env.PAPERCLIP_SCHEDULER_TICK_MS ?? 60_000),
} as const;

export type Config = typeof config;
