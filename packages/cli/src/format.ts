/**
 * Output formatters.
 *
 * Two modes:
 *   pretty (default for interactive runs) — short, editorial, human-friendly
 *   json   (--json or piped) — raw JSON, pretty-printed to stdout
 *
 * Auto-detection: if stdout is not a TTY (e.g. piped to jq), default to JSON.
 * Override with --json or --pretty.
 */

import type { ParsedArgs } from "./argv.js";

export type OutputMode = "pretty" | "json";

export function detectMode(flags: ParsedArgs["flags"]): OutputMode {
  if (flags.json) return "json";
  if (flags.pretty) return "pretty";
  // node 22 guarantees process.stdout.isTTY
  return process.stdout.isTTY ? "pretty" : "json";
}

export function emit(mode: OutputMode, value: unknown): void {
  if (mode === "json") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  // pretty: leave as caller's job — they print specific lines.
  // This branch only fires when callers passed a string, which we print.
  if (typeof value === "string") {
    process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
    return;
  }
  // Generic object → fall through to JSON in pretty mode for unmapped shapes.
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function emitError(err: unknown): void {
  if (err instanceof Error) {
    process.stderr.write(`error: ${err.message}\n`);
    return;
  }
  process.stderr.write(`error: ${JSON.stringify(err)}\n`);
}

/** Truncate to a max length with ellipsis. */
export function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Format an ISO timestamp as a short relative string ("3m ago", "yesterday"). */
export function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
