import type { FastifyInstance } from "fastify";

import { config } from "../config.js";
import { query } from "../db.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => {
    type Probe = { ok: boolean; error?: string };
    const probes: Record<string, Probe> = {};

    try {
      await query("SELECT 1");
      probes.postgres = { ok: true };
    } catch (e) {
      probes.postgres = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    try {
      const r = await fetch(`${config.gbrainUrl}/healthz`, {
        signal: AbortSignal.timeout(2_000),
      });
      probes.gbrain = { ok: r.ok };
    } catch (e) {
      probes.gbrain = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    return {
      ok: Object.values(probes).every((p) => p.ok),
      version: "0.1.0",
      env: config.env,
      probes,
    };
  });
}
