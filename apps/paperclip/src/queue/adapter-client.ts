/**
 * HTTP client speaking the Agent Adapter Contract from docs/API.md.
 * One client per agent kind; URLs come from the registry.
 */

import type { Scope } from "../schemas.js";

export type AdapterRunRequest = {
  goal_id: string;
  run_id: string;
  input: Record<string, unknown>;
  scope: Scope;
};

export type AdapterRunState = {
  status: "running" | "succeeded" | "failed" | "cancelled";
  output?: Record<string, unknown> | null;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

export class AdapterClient {
  constructor(public readonly baseUrl: string) {}

  async startRun(req: AdapterRunRequest): Promise<void> {
    const r = await fetch(`${this.baseUrl}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok && r.status !== 202) {
      const body = await r.text().catch(() => "");
      throw new Error(`adapter start failed: HTTP ${r.status} ${body.slice(0, 200)}`);
    }
  }

  async getRun(runId: string): Promise<AdapterRunState> {
    const r = await fetch(`${this.baseUrl}/run/${encodeURIComponent(runId)}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) {
      throw new Error(`adapter poll failed: HTTP ${r.status}`);
    }
    return (await r.json()) as AdapterRunState;
  }

  async cancel(runId: string): Promise<void> {
    await fetch(`${this.baseUrl}/run/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {
      /* best-effort */
    });
  }
}
