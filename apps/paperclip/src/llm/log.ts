/**
 * Best-effort writer for `ops.llm_call_log`. Called from `narrate()` (and
 * any future LLM caller) on every completion — success or error. Logging
 * is non-blocking: a DB failure here must never break the originating
 * request, so we swallow exceptions and log to the process logger.
 *
 * The row mirrors what Portkey already records in its dashboard, but
 * keeping a local copy means `bc tail` / `bc llm` / the future console
 * can render LLM cost + latency without leaving paperclip. It's also
 * our forensic backup if Portkey is unreachable.
 */

import type pg from "pg";

import { withOrgScope, withSystemScope } from "../db.js";

export type LlmCallLogInput = {
  orgId: string | null;
  runId: string | null;
  provider: "anthropic" | "openrouter";
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  status: "ok" | "error";
  error?: string | null;
  traceId?: string | null;
};

export async function recordLlmCall(input: LlmCallLogInput): Promise<void> {
  const insert = async (client: pg.PoolClient): Promise<void> => {
    await client.query(
      `INSERT INTO ops.llm_call_log
         (org_id, run_id, provider, model, tokens_in, tokens_out,
          latency_ms, status, error, portkey_trace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.orgId,
        input.runId,
        input.provider,
        input.model,
        Math.max(0, Math.floor(input.tokensIn)),
        Math.max(0, Math.floor(input.tokensOut)),
        Math.max(0, Math.floor(input.latencyMs)),
        input.status,
        input.error ?? null,
        input.traceId ?? null,
      ],
    );
  };

  try {
    if (input.orgId) {
      await withOrgScope(input.orgId, insert);
    } else {
      await withSystemScope(insert);
    }
  } catch (err) {
    // Best-effort logging — DB write must never break the originating
    // request. Surface to stderr so the failure shows up in container logs.
    process.stderr.write(
      `[llm_call_log] insert failed: ${(err as Error).message}\n`,
    );
  }
}
