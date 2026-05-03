import type { Goal, GoalStatus, RunStatus } from "@blankcollar/shared";

const STATUS_DOT: Record<GoalStatus, string> = {
  draft: "idle",
  active: "pos",
  paused: "warn",
  achieved: "info",
  archived: "idle",
};

export function statusDot(status: GoalStatus): string {
  return STATUS_DOT[status] ?? "idle";
}

export function statusLabel(status: GoalStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

const RUN_DOT: Record<RunStatus, string> = {
  queued: "idle",
  running: "info",
  succeeded: "pos",
  failed: "neg",
  cancelled: "warn",
};

export function runDot(status: RunStatus): string {
  return RUN_DOT[status] ?? "idle";
}

export function progressPercent(g: Pick<Goal, "progress">): number {
  if (g.progress == null) return 0;
  const n = typeof g.progress === "string" ? Number.parseFloat(g.progress) : g.progress;
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  const diffMs = ms - Date.now();
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return RTF.format(Math.round(diffMs / 60_000), "minute");
  if (abs < 86_400_000) return RTF.format(Math.round(diffMs / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return RTF.format(Math.round(diffMs / 86_400_000), "day");
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dueLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
