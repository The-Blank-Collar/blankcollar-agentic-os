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
} as const;

export type Config = typeof config;
