/**
 * Briefing composer.
 *
 * Pulls the recent state of the studio (last N hours) and renders an editorial
 * markdown summary. v0 is templated — deterministic, no LLM cost, works offline.
 *
 * Phase 5 upgrade: route the same input through Hermes for narrative prose in
 * brand voice. The output shape stays the same; only the rendering changes,
 * so the API contract and UI bindings don't move.
 */

import { query } from "./db.js";

export type BriefingKind = "daily" | "weekly" | "on_demand";

export type BriefingSources = {
  period_start: string;
  period_end: string;
  hours: number;
  goal_count: number;
  active_goal_count: number;
  decision_count: number;
  run_count: number;
  audit_count: number;
};

export type Briefing = {
  kind: BriefingKind;
  period_start: string;
  period_end: string;
  summary_md: string;
  sources: BriefingSources;
};

const KIND_HOURS: Record<BriefingKind, number> = {
  daily: 24,
  weekly: 24 * 7,
  on_demand: 24,
};

type GoalForBriefing = { id: string; title: string; kind: string; status: string; due_at: string | null; progress: string | null };
type DecisionForBriefing = { id: string; title: string; created_at: string };
type RunRollup = { status: string; ct: string };
type CountRow = { ct: string };

export async function composeBriefing(
  orgId: string,
  kind: BriefingKind,
  periodHoursOverride?: number,
): Promise<Briefing> {
  const hours = periodHoursOverride ?? KIND_HOURS[kind];
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - hours * 3_600_000);

  const [goals, decisions, runs, audits] = await Promise.all([
    query<GoalForBriefing>(
      `SELECT id, title, kind, status, due_at, progress
         FROM ops.goal
        WHERE org_id = $1
          AND status IN ('draft','active','paused')
        ORDER BY updated_at DESC
        LIMIT 50`,
      [orgId],
    ),
    query<DecisionForBriefing>(
      `SELECT id, title, created_at
         FROM ops.goal
        WHERE org_id = $1
          AND kind = 'decision'
          AND status IN ('draft','active')
        ORDER BY created_at DESC
        LIMIT 20`,
      [orgId],
    ),
    query<RunRollup>(
      `SELECT status, count(*)::text AS ct
         FROM ops.run r
         JOIN ops.goal g ON g.id = r.goal_id
        WHERE g.org_id = $1
          AND r.created_at >= $2
        GROUP BY status`,
      [orgId, periodStart.toISOString()],
    ),
    query<CountRow>(
      `SELECT count(*)::text AS ct
         FROM core.audit_log
        WHERE org_id = $1
          AND created_at >= $2`,
      [orgId, periodStart.toISOString()],
    ),
  ]);

  const runByStatus: Record<string, number> = {};
  for (const r of runs.rows) runByStatus[r.status] = Number(r.ct);
  const runTotal = Object.values(runByStatus).reduce((a, b) => a + b, 0);
  const succeeded = runByStatus.succeeded ?? 0;
  const failed = runByStatus.failed ?? 0;
  const running = runByStatus.running ?? 0;

  const activeGoals: GoalForBriefing[] = goals.rows.filter((g: GoalForBriefing) => g.status === "active");
  const dueSoon = activeGoals
    .filter((g: GoalForBriefing) => g.due_at && new Date(g.due_at) < new Date(periodEnd.getTime() + 7 * 24 * 3_600_000))
    .slice(0, 5);

  const sources: BriefingSources = {
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    hours,
    goal_count: goals.rows.length,
    active_goal_count: activeGoals.length,
    decision_count: decisions.rows.length,
    run_count: runTotal,
    audit_count: Number(audits.rows[0]?.ct ?? 0),
  };

  const summary_md = renderTemplate({
    kind,
    activeGoals,
    decisions: decisions.rows,
    dueSoon,
    succeeded,
    failed,
    running,
    runTotal,
    auditCount: sources.audit_count,
    hours,
  });

  return { kind, period_start: sources.period_start, period_end: sources.period_end, summary_md, sources };
}

function renderTemplate(s: {
  kind: BriefingKind;
  activeGoals: { id: string; title: string; kind: string; due_at: string | null }[];
  decisions: { id: string; title: string }[];
  dueSoon: { id: string; title: string; due_at: string | null }[];
  succeeded: number;
  failed: number;
  running: number;
  runTotal: number;
  auditCount: number;
  hours: number;
}): string {
  const window = s.kind === "weekly" ? "this week" : s.kind === "daily" ? "yesterday" : `the last ${s.hours} hours`;
  const lines: string[] = [];

  // Opening — editorial, never managerial.
  if (s.decisions.length === 0 && s.activeGoals.length === 0) {
    lines.push(`Quiet ${window}. Nothing wants you right now.`);
  } else if (s.decisions.length === 0) {
    lines.push(`Calm ${window}. ${s.activeGoals.length} thing${s.activeGoals.length === 1 ? "" : "s"} in flight, nothing waiting on you.`);
  } else if (s.decisions.length === 1) {
    lines.push(`One decision wants you ${window === "this week" ? "this week" : "today"}. The rest is moving without you.`);
  } else {
    lines.push(`${s.decisions.length} decisions want you ${window === "this week" ? "this week" : "today"}. Everything else is in flight.`);
  }

  // Decisions section — most important, surface first.
  if (s.decisions.length > 0) {
    lines.push("", "## Wants you");
    for (const d of s.decisions.slice(0, 8)) {
      lines.push(`- ${d.title}`);
    }
  }

  // Due soon.
  if (s.dueSoon.length > 0) {
    lines.push("", "## Coming up");
    for (const g of s.dueSoon) {
      const when = g.due_at ? new Date(g.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "soon";
      lines.push(`- ${g.title} — ${when}`);
    }
  }

  // What flowed without you.
  if (s.runTotal > 0) {
    lines.push("", "## Moving on its own");
    const pieces: string[] = [];
    if (s.succeeded > 0) pieces.push(`${s.succeeded} run${s.succeeded === 1 ? "" : "s"} completed`);
    if (s.running > 0) pieces.push(`${s.running} still working`);
    if (s.failed > 0) pieces.push(`${s.failed} failed`);
    lines.push(pieces.join(" · "));
  }

  // Active in flight (cap at 6 to keep the briefing scannable).
  if (s.activeGoals.length > 0) {
    lines.push("", "## In flight");
    for (const g of s.activeGoals.slice(0, 6)) {
      const tag = g.kind === "standing" ? " (standing)" : g.kind === "routine" ? " (routine)" : "";
      lines.push(`- ${g.title}${tag}`);
    }
    if (s.activeGoals.length > 6) {
      lines.push(`- …and ${s.activeGoals.length - 6} more.`);
    }
  }

  return lines.join("\n");
}
