import type { Client } from "../api.js";
import type { ParsedArgs } from "../argv.js";
import { flagBool, flagInt, flagString } from "../argv.js";
import { detectMode, emit, relative, trunc } from "../format.js";

type Call = {
  id: string;
  run_id: string | null;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  status: string;
  error: string | null;
  portkey_trace_id: string | null;
  created_at: string;
};

type Summary = {
  period_hours: number;
  total: number;
  tokens_in: number;
  tokens_out: number;
  avg_latency_ms: number | null;
  errors: number;
  by_model: Array<{ model: string; count: number; tokens_in: number; tokens_out: number }>;
  by_status: Array<{ status: string; count: number }>;
};

const STATUS_GLYPH: Record<string, string> = {
  ok: "✓",
  error: "✗",
};

export async function runLlm(args: ParsedArgs, client: Client): Promise<number> {
  const mode = detectMode(args.flags);

  if (flagBool(args.flags, "summary")) {
    const hours = flagInt(args.flags, "hours", 24);
    const sum = await client.get<Summary>("/api/llm/summary", { hours });
    if (mode === "json") {
      emit("json", sum);
      return 0;
    }
    const avg = sum.avg_latency_ms != null ? `${sum.avg_latency_ms}ms` : "—";
    const lines = [
      `LLM calls · last ${sum.period_hours}h`,
      `  total:        ${sum.total}`,
      `  tokens in:    ${sum.tokens_in.toLocaleString()}`,
      `  tokens out:   ${sum.tokens_out.toLocaleString()}`,
      `  avg latency:  ${avg}`,
      `  errors:       ${sum.errors}`,
    ];
    if (sum.by_model.length > 0) {
      lines.push("", "by model:");
      for (const m of sum.by_model) {
        lines.push(`  ${m.model.padEnd(28)} ${String(m.count).padStart(4)}  in=${m.tokens_in.toLocaleString().padStart(8)}  out=${m.tokens_out.toLocaleString().padStart(8)}`);
      }
    }
    emit("pretty", lines.join("\n"));
    return 0;
  }

  const limit = flagInt(args.flags, "limit", 30);
  const params: Record<string, string | number | boolean | undefined> = { limit };
  const status = flagString(args.flags, "status", "");
  const provider = flagString(args.flags, "provider", "");
  if (status) params.status = status;
  if (provider) params.provider = provider;
  const calls = await client.get<Call[]>("/api/llm/calls", params);

  if (mode === "json") {
    emit("json", calls);
    return 0;
  }
  if (calls.length === 0) {
    emit("pretty", "no LLM calls.");
    return 0;
  }
  const lines = [`LLM calls · ${calls.length} most recent`];
  for (const c of calls) {
    const glyph = STATUS_GLYPH[c.status] ?? "·";
    const tokens = `in=${String(c.tokens_in).padStart(5)} out=${String(c.tokens_out).padStart(5)}`;
    const lat = `${c.latency_ms}ms`.padStart(7);
    const err = c.error ? `  — ${trunc(c.error, 50)}` : "";
    lines.push(
      `  ${glyph} ${c.id.slice(0, 8)} ${c.provider.padEnd(10)} ${trunc(c.model, 22).padEnd(22)} ${tokens}  ${lat}  ${relative(c.created_at)}${err}`,
    );
  }
  emit("pretty", lines.join("\n"));
  return 0;
}
