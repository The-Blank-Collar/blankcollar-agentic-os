/**
 * Best-effort writer for `ops.tool_call_log`. Mirrors `llm/log.ts` for
 * MCP tool invocations. Called from the tool-invoke route on every
 * call (success or error). Logging is non-blocking: a DB failure here
 * must never break the originating request.
 */

import type pg from "pg";

import { withOrgScope, withSystemScope } from "../db.js";

export type ToolCallLogInput = {
  orgId: string | null;
  runId: string | null;
  toolSlug: string;
  toolVersion: number;
  input: Record<string, unknown>;
  output: unknown;
  isError: boolean;
  error: string | null;
  latencyMs: number;
  stderrTail: string | null;
};

export async function recordToolCall(input: ToolCallLogInput): Promise<void> {
  const insert = async (client: pg.PoolClient): Promise<void> => {
    await client.query(
      `INSERT INTO ops.tool_call_log
         (org_id, run_id, tool_slug, tool_version, input, output,
          is_error, error, latency_ms, stderr_tail)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb,
               $7, $8, $9, $10)`,
      [
        input.orgId,
        input.runId,
        input.toolSlug,
        input.toolVersion,
        JSON.stringify(input.input ?? {}),
        input.output === undefined ? null : JSON.stringify(input.output),
        input.isError,
        input.error,
        Math.max(0, Math.floor(input.latencyMs)),
        input.stderrTail,
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
    process.stderr.write(
      `[tool_call_log] insert failed: ${(err as Error).message}\n`,
    );
  }
}
