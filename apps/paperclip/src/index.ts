/** Paperclip — orchestrator + dashboard. */

import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import Fastify from "fastify";

import { authPreHandler } from "./auth.js";
import { applyAdditiveMigrations, ensureDefaultAgents } from "./bootstrap.js";
import { config, requireConfig } from "./config.js";
import { close as closeDb } from "./db.js";
import { worker } from "./queue/worker.js";
import { scheduler } from "./scheduler.js";
import { agentRoutes } from "./routes/agents.js";
import { approvalRoutes } from "./routes/approvals.js";
import { autonomyRoutes } from "./routes/autonomy.js";
import { auditRoutes } from "./routes/audit.js";
import { billingRoutes } from "./routes/billing.js";
import { brainRoutes } from "./routes/brain.js";
import { briefingRoutes } from "./routes/briefings.js";
import { captureRoutes } from "./routes/captures.js";
import { channelRoutes } from "./routes/channels.js";
import { connectorRoutes } from "./routes/connectors.js";
import { goalRoutes } from "./routes/goals.js";
import { healthRoutes } from "./routes/health.js";
import { heartbeatRoutes } from "./routes/heartbeat.js";
import { inboxRoutes } from "./routes/inbox.js";
import { keyResultRoutes } from "./routes/keyresults.js";
import { documentRoutes } from "./routes/documents.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { upstreamRoutes } from "./routes/upstream.js";
import { invitationRoutes } from "./routes/invitations.js";
import { llmRoutes } from "./routes/llm.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { orgRoutes } from "./routes/orgs.js";
import { outcomeRoutes } from "./routes/outcomes.js";
import { paymentRoutes } from "./routes/payments.js";
import { policyRoutes } from "./routes/policies.js";
import { routineRoutes } from "./routes/routines.js";
import { runRoutes } from "./routes/runs.js";
import { safeguardRoutes } from "./routes/safeguards.js";
import { searchRoutes } from "./routes/search.js";
import { selfImprovementRoutes } from "./routes/self_improvement.js";
import { skillDraftRoutes } from "./routes/skill_drafts.js";
import { skillRoutes } from "./routes/skills.js";
import { statsRoutes } from "./routes/stats.js";
import { swarmRoutes } from "./routes/swarms.js";
import { toolRoutes } from "./routes/tools.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { syncSkillRegistry } from "./skills/registry.js";
import { probeRegisteredTools, syncToolRegistry } from "./tools/registry.js";

async function main(): Promise<void> {
  // Fail-fast on missing required env (Portkey keys, etc.) before opening
  // the listener. Clear error message > silent runtime null returns.
  requireConfig();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.env === "local" ? { target: "pino-pretty" } : undefined,
    },
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(formbody);

  // CORS — the React console at apps/website/ talks to /api/* from a
  // different origin (`:3000` → `:3001`). Browsers block cross-origin
  // fetches without an explicit Access-Control-Allow-Origin response.
  // Allowed origins:
  //   - http://localhost:3000  — local dev (the new console)
  //   - http://127.0.0.1:3000  — same, IP form
  //   - WEBSITE_PUBLIC_URL     — production website (e.g. https://blankcollar.ai)
  //                              comma-separated; defaults to "" (no extras)
  const corsOrigins = new Set<string>([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
  for (const o of (process.env.WEBSITE_PUBLIC_URL ?? "").split(",")) {
    const trimmed = o.trim();
    if (trimmed) corsOrigins.add(trimmed);
  }
  await app.register(cors, {
    origin: Array.from(corsOrigins),
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-BC-Org-Slug",
    ],
    credentials: true,
    maxAge: 86_400,
  });

  // Supabase JWT auth (no-op when SUPABASE_JWT_SECRET unset).
  app.addHook("preHandler", authPreHandler);
  if (config.supabaseJwtSecret) {
    app.log.info(
      `auth=supabase enforce=${config.authEnforce} (set PAPERCLIP_AUTH_ENFORCE=true to require tokens)`,
    );
  } else {
    app.log.info("auth=stub (Supabase not configured; demo-org owner for all callers)");
  }
  if (config.rlsStrict) {
    app.log.info("auth.rls=strict — unscoped queries on tenant tables return 0 rows");
  } else {
    app.log.warn(
      "auth.rls=permissive — unscoped queries on tenant tables fall through. " +
        "Set PAPERCLIP_RLS_STRICT=true (default) to lock down.",
    );
  }

  // webhookRoutes registers its own content-type parser; must be before the
  // route registrations that rely on the default JSON parser.
  await app.register(webhookRoutes);
  await app.register(healthRoutes);
  await app.register(orgRoutes);
  await app.register(invitationRoutes);
  await app.register(outcomeRoutes);
  await app.register(goalRoutes);
  await app.register(keyResultRoutes);
  await app.register(captureRoutes);
  await app.register(briefingRoutes);
  await app.register(inboxRoutes);
  await app.register(heartbeatRoutes);
  await app.register(brainRoutes);
  await app.register(skillRoutes);
  await app.register(skillDraftRoutes);
  await app.register(toolRoutes);
  await app.register(routineRoutes);
  await app.register(onboardingRoutes);
  await app.register(paymentRoutes);
  await app.register(billingRoutes);
  await app.register(policyRoutes);
  await app.register(selfImprovementRoutes);
  await app.register(knowledgeRoutes);
  await app.register(documentRoutes);
  await app.register(upstreamRoutes);
  await app.register(llmRoutes);
  await app.register(approvalRoutes);
  await app.register(channelRoutes);
  await app.register(connectorRoutes);
  await app.register(runRoutes);
  await app.register(safeguardRoutes);
  await app.register(searchRoutes);
  await app.register(statsRoutes);
  await app.register(swarmRoutes);
  await app.register(agentRoutes);
  await app.register(auditRoutes);
  await app.register(autonomyRoutes);

  // Paperclip serves /api/*, /webhooks/*, and /healthz only — the htmx
  // dashboard was retired in Phase 4 and the React console at apps/website
  // owns the user-facing surface (port 3000). Anything else gets a JSON
  // 404 with a hint pointing at the new front door.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    reply.code(404).send({
      error: "not_found",
      hint: "the user-facing UI lives at the website service (default :3000); paperclip serves /api/* and /webhooks/*",
    });
  });

  // Additive schema migrations — idempotent, run every boot so existing dev
  // volumes don't need a wipe to pick up new tables.
  try {
    await applyAdditiveMigrations({ info: (msg) => app.log.info(msg) });
  } catch (err) {
    app.log.error({ err }, "additive migrations failed");
  }

  // First-boot bootstrap: ensure Hermes + OpenClaw rows exist in ops.agent.
  try {
    await ensureDefaultAgents({ info: (msg) => app.log.info(msg) });
  } catch (err) {
    app.log.error({ err }, "default-agents bootstrap failed");
  }

  // Skills registry sync — reads packages/skills/manifests/ from disk and
  // upserts every shared manifest into ops.skill.
  try {
    await syncSkillRegistry({
      info: (msg) => app.log.info(msg),
      warn: (msg) => app.log.warn(msg),
      error: (err, msg) => app.log.error({ err }, msg),
    });
  } catch (err) {
    app.log.error({ err }, "skills registry sync failed");
  }

  // Tools registry sync — same shape, packages/tools/manifests/.
  try {
    await syncToolRegistry({
      info: (msg) => app.log.info(msg),
      warn: (msg) => app.log.warn(msg),
      error: (err, msg) => app.log.error({ err }, msg),
    });
  } catch (err) {
    app.log.error({ err }, "tools registry sync failed");
  }

  // Background probe of every stdio tool — non-blocking, fire-and-forget.
  // Sequential so we don't fork dozens of npx processes at once. Any tool
  // that fails the MCP `initialize` handshake gets enabled=false until
  // the operator fixes + bumps the manifest version. Skipped when the
  // env var explicitly opts out (useful for tests + smoke runs).
  if (process.env.PAPERCLIP_TOOL_PROBE_AT_BOOT !== "false") {
    void (async () => {
      try {
        await probeRegisteredTools({
          info: (msg) => app.log.info(msg),
          warn: (msg) => app.log.warn(msg),
          error: (err, msg) => app.log.error({ err }, msg),
        });
      } catch (err) {
        app.log.error({ err }, "tools probe failed");
      }
    })();
  }

  if (config.workerEnabled) {
    worker.start({
      info: (msg) => app.log.info(msg),
      error: (err, msg) => app.log.error({ err }, msg),
    });
  } else {
    app.log.info("worker disabled (PAPERCLIP_WORKER_ENABLED=false)");
  }

  if (config.schedulerEnabled) {
    scheduler.start({
      info: (msg) => app.log.info(msg),
      warn: (msg) => app.log.warn(msg),
      error: (err, msg) => app.log.error({ err }, msg),
    });
  } else {
    app.log.info("scheduler disabled (PAPERCLIP_SCHEDULER_ENABLED=false)");
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    try {
      await scheduler.stop();
      await worker.stop();
      await app.close();
      await closeDb();
    } catch (err) {
      app.log.error({ err }, "shutdown error");
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ host: "0.0.0.0", port: config.port });
  } catch (err) {
    app.log.error({ err }, "failed to start");
    process.exit(1);
  }
}

void main();
