/** Paperclip — orchestrator + dashboard. */

import formbody from "@fastify/formbody";
import Fastify from "fastify";

import { authPreHandler } from "./auth.js";
import { applyAdditiveMigrations, ensureDefaultAgents } from "./bootstrap.js";
import { config } from "./config.js";
import { close as closeDb } from "./db.js";
import { worker } from "./queue/worker.js";
import { agentRoutes } from "./routes/agents.js";
import { auditRoutes } from "./routes/audit.js";
import { briefingRoutes } from "./routes/briefings.js";
import { captureRoutes } from "./routes/captures.js";
import { goalRoutes } from "./routes/goals.js";
import { healthRoutes } from "./routes/health.js";
import { keyResultRoutes } from "./routes/keyresults.js";
import { orgRoutes } from "./routes/orgs.js";
import { runRoutes } from "./routes/runs.js";
import { uiRoutes } from "./routes/ui.js";
import { webhookRoutes } from "./routes/webhooks.js";

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.env === "local" ? { target: "pino-pretty" } : undefined,
    },
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(formbody);

  // Supabase JWT auth (no-op when SUPABASE_JWT_SECRET unset).
  app.addHook("preHandler", authPreHandler);
  if (config.supabaseJwtSecret) {
    app.log.info(
      `auth=supabase enforce=${config.authEnforce} (set PAPERCLIP_AUTH_ENFORCE=true to require tokens)`,
    );
  } else {
    app.log.info("auth=stub (Supabase not configured; demo-org owner for all callers)");
  }

  // webhookRoutes registers its own content-type parser; must be before the
  // route registrations that rely on the default JSON parser.
  await app.register(webhookRoutes);
  await app.register(healthRoutes);
  await app.register(orgRoutes);
  await app.register(goalRoutes);
  await app.register(keyResultRoutes);
  await app.register(captureRoutes);
  await app.register(briefingRoutes);
  await app.register(runRoutes);
  await app.register(agentRoutes);
  await app.register(auditRoutes);
  await app.register(uiRoutes);

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    reply.code(404).type("text/html").send(
      `<!doctype html><body style="font-family:system-ui;background:#0b0d10;color:#e7eaee;display:grid;place-items:center;min-height:100vh"><div style="text-align:center"><h1>Not found</h1><p><a style="color:#7aa7ff" href="/">← Goals</a></p></div></body>`,
    );
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

  if (config.workerEnabled) {
    worker.start({
      info: (msg) => app.log.info(msg),
      error: (err, msg) => app.log.error({ err }, msg),
    });
  } else {
    app.log.info("worker disabled (PAPERCLIP_WORKER_ENABLED=false)");
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    try {
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
