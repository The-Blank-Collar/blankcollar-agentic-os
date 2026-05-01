import type { FastifyInstance } from "fastify";

import { config } from "../config.js";
import { googleConnectorsReady } from "../connectors/google.js";
import { query } from "../db.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => {
    type Probe = { ok: boolean; error?: string };
    const probes: Record<string, Probe> = {};

    // -- Postgres ---------------------------------------------------------
    try {
      await query("SELECT 1");
      probes.postgres = { ok: true };
    } catch (e) {
      probes.postgres = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // -- gbrain -----------------------------------------------------------
    try {
      const r = await fetch(`${config.gbrainUrl}/healthz`, {
        signal: AbortSignal.timeout(2_000),
      });
      probes.gbrain = { ok: r.ok };
    } catch (e) {
      probes.gbrain = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // -- Hermes (best-effort; not required for health to be ok) -----------
    try {
      const url = process.env.HERMES_URL ?? "http://hermes:80";
      const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2_000) });
      probes.hermes = { ok: r.ok };
    } catch (e) {
      probes.hermes = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // -- OpenClaw ---------------------------------------------------------
    try {
      const url = process.env.OPENCLAW_URL ?? "http://openclaw:80";
      const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2_000) });
      probes.openclaw = { ok: r.ok };
    } catch (e) {
      probes.openclaw = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // -- Workspace connectors (Nango) -------------------------------------
    const google = await googleConnectorsReady();
    probes.workspace = google.ok ? { ok: true } : { ok: false, error: google.reason };

    // -- Counts (no probe; informational) ---------------------------------
    let counts: Record<string, number> = {};
    try {
      const { rows: [skillCount] } = await query<{ ct: string }>(
        "SELECT count(*)::text AS ct FROM ops.skill WHERE enabled = true",
      );
      const { rows: [agentCount] } = await query<{ ct: string }>(
        "SELECT count(*)::text AS ct FROM ops.agent WHERE is_active = true",
      );
      const { rows: [routineCount] } = await query<{ ct: string }>(
        "SELECT count(*)::text AS ct FROM ops.goal WHERE kind = 'routine' AND status IN ('draft','active')",
      );
      const { rows: [pendingApprovalCount] } = await query<{ ct: string }>(
        "SELECT count(*)::text AS ct FROM ops.approval WHERE resolution IS NULL",
      );
      counts = {
        skills_enabled: Number(skillCount?.ct ?? 0),
        agents_active: Number(agentCount?.ct ?? 0),
        routines_active: Number(routineCount?.ct ?? 0),
        approvals_pending: Number(pendingApprovalCount?.ct ?? 0),
      };
    } catch {
      counts = {};
    }

    // Required-for-ok subset: postgres + gbrain. Other probes inform but
    // don't gate the binary "ok" — Hermes can be down without health
    // failing in single-user offline mode.
    const required: Probe[] = [probes.postgres!, probes.gbrain!];

    return {
      ok: required.every((p) => p.ok),
      version: "0.1.0",
      env: config.env,
      probes,
      runtime: {
        worker_enabled: config.workerEnabled,
        scheduler_enabled: config.schedulerEnabled,
        briefing_hour_utc: config.briefingHourUtc,
        llm_configured: Boolean(config.anthropicApiKey),
      },
      counts,
    };
  });
}
