/**
 * Self-Improvement engine — composes Audit + Level-Up reports.
 *
 * Audit:    "what happened the last 7 days, where did things stick"
 *           Read-only summary of decisions, runs, captures, audit-log
 *           events. Surface unresolved decisions, dropped drafts,
 *           recurring blockers.
 *
 * Level-Up: "given the audit, what should we change next week"
 *           Concrete suggestions: routines to add, governance to tighten,
 *           skills to enable. Stored as JSON in audit_report.suggestions
 *           so the UI / future operators can apply with one click.
 *
 * Both run on the same data shape Hermes uses for the daily briefing,
 * just with a longer period and a different prompt. Templated v0; the
 * narrate() helper upgrades to LLM prose when ANTHROPIC_API_KEY is set.
 */

import { audit } from "../audit.js";
import { query, tx } from "../db.js";
import { narrate } from "../llm.js";
import type { Scope } from "../schemas.js";

export type AuditFinding = {
  category: string;
  detail: string;
  count?: number;
  example_id?: string;
};

export type LevelUpSuggestion = {
  category: string;
  proposal: string;
  // Optional auto-apply hint — what the UI / system would do if approved.
  apply_action?: {
    kind: "create_routine" | "tighten_governance" | "enable_skill" | "create_knowledge_doc";
    payload: Record<string, unknown>;
  };
};

export type AuditReport = {
  kind: "audit" | "level_up";
  period_start: string;
  period_end: string;
  summary_md: string;
  findings: AuditFinding[];
  suggestions: LevelUpSuggestion[];
};

export async function composeAudit(
  orgId: string,
  periodHours: number,
  userId?: string,
): Promise<AuditReport> {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - periodHours * 3_600_000);
  const periodStartIso = periodStart.toISOString();

  const userFilter = userId ? "AND actor_id = $3" : "";
  const userParams = userId ? [orgId, periodStartIso, userId] : [orgId, periodStartIso];

  const [
    decisionsOpen,
    decisionsResolved,
    runsByStatus,
    capturesByKind,
    blockedGoals,
    auditTotal,
  ] = await Promise.all([
    query<{ ct: string }>(
      `SELECT count(*)::text AS ct
         FROM ops.goal
        WHERE org_id = $1
          AND kind = 'decision'
          AND status IN ('draft','active')
          AND created_at >= $2`,
      [orgId, periodStartIso],
    ),
    query<{ ct: string }>(
      `SELECT count(*)::text AS ct
         FROM ops.goal
        WHERE org_id = $1
          AND kind = 'decision'
          AND status IN ('achieved','archived')
          AND updated_at >= $2`,
      [orgId, periodStartIso],
    ),
    query<{ status: string; ct: string }>(
      `SELECT r.status, count(*)::text AS ct
         FROM ops.run r
         JOIN ops.goal g ON g.id = r.goal_id
        WHERE g.org_id = $1
          AND r.created_at >= $2
        GROUP BY r.status`,
      [orgId, periodStartIso],
    ),
    query<{ source: string; ct: string }>(
      `SELECT source::text AS source, count(*)::text AS ct
         FROM ops.capture
        WHERE org_id = $1
          AND created_at >= $2
        GROUP BY source`,
      [orgId, periodStartIso],
    ),
    query<{ id: string; title: string }>(
      `SELECT id, title
         FROM ops.goal
        WHERE org_id = $1
          AND status = 'paused'
          AND updated_at >= $2
        LIMIT 10`,
      [orgId, periodStartIso],
    ),
    query<{ ct: string }>(
      `SELECT count(*)::text AS ct
         FROM core.audit_log
        WHERE org_id = $1 AND created_at >= $2 ${userFilter}`,
      userParams,
    ),
  ]);

  const findings: AuditFinding[] = [];
  const open = Number(decisionsOpen.rows[0]?.ct ?? 0);
  const resolved = Number(decisionsResolved.rows[0]?.ct ?? 0);
  if (open > 0) {
    findings.push({
      category: "decisions",
      detail: `${open} decision${open === 1 ? "" : "s"} still pending from this period`,
      count: open,
    });
  }
  if (resolved > 0) {
    findings.push({
      category: "decisions",
      detail: `${resolved} decision${resolved === 1 ? "" : "s"} resolved this period`,
      count: resolved,
    });
  }
  const runMap: Record<string, number> = {};
  for (const r of runsByStatus.rows) runMap[r.status] = Number(r.ct);
  if ((runMap.failed ?? 0) > 0) {
    findings.push({
      category: "runs",
      detail: `${runMap.failed} agent run${runMap.failed === 1 ? "" : "s"} failed`,
      count: runMap.failed,
    });
  }
  if ((runMap.succeeded ?? 0) > 0) {
    findings.push({
      category: "runs",
      detail: `${runMap.succeeded} run${runMap.succeeded === 1 ? "" : "s"} completed`,
      count: runMap.succeeded,
    });
  }
  for (const blocked of blockedGoals.rows) {
    findings.push({
      category: "blockers",
      detail: `Paused: "${blocked.title}"`,
      example_id: blocked.id,
    });
  }
  for (const c of capturesByKind.rows) {
    if (Number(c.ct) > 0) {
      findings.push({
        category: "intake",
        detail: `${c.ct} capture${Number(c.ct) === 1 ? "" : "s"} via ${c.source}`,
        count: Number(c.ct),
      });
    }
  }
  findings.push({
    category: "activity",
    detail: `${auditTotal.rows[0]?.ct ?? "0"} audit-log events`,
    count: Number(auditTotal.rows[0]?.ct ?? 0),
  });

  const summary_md = await renderAuditSummary(findings, periodHours);

  return {
    kind: "audit",
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    summary_md,
    findings,
    suggestions: [],
  };
}

export async function composeLevelUp(
  orgId: string,
  basisAuditId?: string,
): Promise<AuditReport> {
  // Pull the most recent audit if no specific id provided.
  const { rows: auditRows } = basisAuditId
    ? await query<{ id: string; period_start: string; period_end: string; findings: AuditFinding[] }>(
        `SELECT id, period_start, period_end, findings FROM ops.audit_report
          WHERE id = $1 AND org_id = $2 AND kind = 'audit'`,
        [basisAuditId, orgId],
      )
    : await query<{ id: string; period_start: string; period_end: string; findings: AuditFinding[] }>(
        `SELECT id, period_start, period_end, findings FROM ops.audit_report
          WHERE org_id = $1 AND kind = 'audit' ORDER BY created_at DESC LIMIT 1`,
        [orgId],
      );
  const periodEnd = new Date();
  const periodStart = auditRows[0]?.period_start
    ? new Date(auditRows[0].period_start)
    : new Date(periodEnd.getTime() - 7 * 24 * 3_600_000);

  const findings: AuditFinding[] = auditRows[0]?.findings ?? [];
  const suggestions: LevelUpSuggestion[] = [];

  for (const f of findings) {
    if (f.category === "decisions" && f.count && f.count > 5) {
      suggestions.push({
        category: "governance",
        proposal:
          "You're accumulating decisions faster than you're resolving them. Consider raising the auto-approve threshold for low-stakes categories.",
        apply_action: {
          kind: "tighten_governance",
          payload: { auto_approve_under: 500 },
        },
      });
    }
    if (f.category === "runs" && f.detail.includes("failed") && f.count && f.count > 3) {
      suggestions.push({
        category: "reliability",
        proposal:
          "Multiple runs failed this period. Recommend enabling the self.audit routine weekly so we can catch the same failure mode earlier next time.",
        apply_action: {
          kind: "create_routine",
          payload: {
            title: "Weekly self-audit",
            cron_expr: "0 9 * * 1",
            invokes_skill: "self.audit",
          },
        },
      });
    }
    if (f.category === "blockers" && f.example_id) {
      suggestions.push({
        category: "blockers",
        proposal: `Goal stayed paused this period — consider revisiting or archiving.`,
        apply_action: {
          kind: "create_knowledge_doc",
          payload: {
            slug: `blocker-${f.example_id.slice(0, 8)}`,
            title: "Stuck goal post-mortem",
            scope: "personal",
          },
        },
      });
    }
  }

  if (suggestions.length === 0) {
    suggestions.push({
      category: "general",
      proposal:
        "Nothing pressing surfaced. Consider adding a personal routine for whatever you keep dropping on Wednesdays.",
    });
  }

  const summary_md = await renderLevelUpSummary(suggestions);

  return {
    kind: "level_up",
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    summary_md,
    findings,
    suggestions,
  };
}

export async function persistReport(
  scope: Scope,
  report: AuditReport,
  userId?: string,
): Promise<{ id: string }> {
  return tx(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ops.audit_report (
         org_id, user_id, kind, period_start, period_end, summary_md,
         findings, suggestions, applied
       )
       VALUES ($1, $2, $3::ops.audit_report_kind, $4, $5, $6, $7::jsonb, $8::jsonb, false)
       RETURNING id`,
      [
        scope.org_id,
        userId ?? null,
        report.kind,
        report.period_start,
        report.period_end,
        report.summary_md,
        JSON.stringify(report.findings),
        JSON.stringify(report.suggestions),
      ],
    );
    const id = rows[0]!.id;
    await audit(
      {
        scope,
        action: report.kind === "audit" ? "self.audit.run" : "self.level_up.run",
        target_type: "audit_report",
        target_id: id,
        metadata: {
          period_start: report.period_start,
          period_end: report.period_end,
          findings_count: report.findings.length,
          suggestions_count: report.suggestions.length,
        },
      },
      client,
    );
    return { id };
  });
}

async function renderAuditSummary(findings: AuditFinding[], hours: number): Promise<string> {
  const window = hours >= 24 * 6 ? "this past week" : `the last ${hours} hours`;
  const lines = [
    `## Self-audit — ${window}`,
    "",
    ...findings.map((f) => `- **${f.category}** — ${f.detail}`),
  ];
  const templated = lines.join("\n");
  const narrated = await narrate({
    systemHint:
      "You are writing a self-audit for one operator (single-user mode) or a department (multi-user). " +
      "Open with one short observation. Keep the bullet list. Don't add facts. Cap at ~150 words.",
    userPrompt:
      "Rewrite this self-audit summary in editorial voice, preserving every finding:\n\n```\n" +
      templated +
      "\n```",
  });
  return narrated ?? templated;
}

async function renderLevelUpSummary(suggestions: LevelUpSuggestion[]): Promise<string> {
  const lines = ["## Level-up — what to change next week", ""];
  for (const s of suggestions) {
    lines.push(`- **${s.category}** — ${s.proposal}`);
  }
  const templated = lines.join("\n");
  const narrated = await narrate({
    systemHint:
      "You are proposing concrete improvements based on a self-audit. Write warmly, like a coach. " +
      "Keep the bullet structure. Don't invent suggestions beyond the ones provided. Cap at ~120 words.",
    userPrompt:
      "Rewrite this level-up plan in editorial voice, preserving every suggestion:\n\n```\n" +
      templated +
      "\n```",
  });
  return narrated ?? templated;
}
