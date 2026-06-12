import { useState } from "react";

import type { GoalWithDetail, KeyResult } from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";
import { describeCron, nextCronFire } from "../lib/cron";
import { dueLabel, relativeTime } from "../lib/format";

/**
 * Per-kind action surface — the right side of the goal hero.
 *
 *   decision  → Approve / Decline (with reason prompt) → status=achieved/archived
 *   routine   → Pause / Resume (status toggle), describe schedule
 *   standing  → Update progress (no special actions yet — KR list does the work)
 *   ephemeral → Mark done → status=achieved
 *
 * Each action rolls a goal metadata patch that records who/when so the audit
 * log captures the human decision.
 */

type Props = {
  g: GoalWithDetail;
  archiving: boolean;
  archiveErr: string | null;
  onArchive: () => Promise<void>;
  onRefetch: () => void;
};

export function GoalKindActions(props: Props) {
  switch (props.g.kind) {
    case "decision":  return <DecisionActions {...props} />;
    case "routine":   return <RoutineActions {...props} />;
    case "ephemeral": return <EphemeralActions {...props} />;
    case "standing":
    default:          return <StandingActions {...props} />;
  }
}

// ─── decision ─────────────────────────────────────────────────────────

function DecisionActions({ g, onRefetch, archiving, onArchive, archiveErr }: Props) {
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const decided = g.status === "achieved" || g.status === "archived";

  const decide = async (kind: "approve" | "decline"): Promise<void> => {
    if (busy || decided) return;
    const reason = window.prompt(
      `${kind === "approve" ? "Approving" : "Declining"} — short reason (optional):`,
      "",
    );
    if (reason === null) return; // cancelled
    setBusy(kind);
    setErr(null);
    try {
      const meta = (g.metadata ?? {}) as Record<string, unknown>;
      await api.patchGoal(g.id, {
        status: kind === "approve" ? "achieved" : "archived",
        metadata: {
          ...meta,
          decision: kind === "approve" ? "approved" : "declined",
          decision_reason: reason || null,
          decision_at: new Date().toISOString(),
        },
      });
      onRefetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (decided) {
    const meta = (g.metadata ?? {}) as Record<string, unknown>;
    const tone = g.status === "achieved" ? "var(--pos)" : "var(--neg)";
    const label = g.status === "achieved" ? "Approved" : "Declined";
    const reason = (meta.decision_reason as string | null | undefined) ?? null;
    return (
      <div className="gactions" style={{ flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <span className="mono" style={{ color: tone, fontSize: 11, letterSpacing: "0.12em" }}>
          {label.toUpperCase()}
        </span>
        {reason && <span className="tiny" style={{ color: "var(--ink-2)", maxWidth: 220, textAlign: "right" }}>{reason}</span>}
        <span className="tiny mono" style={{ color: "var(--muted)" }}>
          {relativeTime(g.updated_at)}
        </span>
      </div>
    );
  }

  return (
    <div className="gactions" style={{ flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      {err && <div className="tiny" style={{ color: "var(--neg)" }}>{err}</div>}
      <div className="stack-h">
        <button
          className="btn btn-sm"
          onClick={() => decide("decline")}
          disabled={busy !== null}
        >
          {busy === "decline" ? "Declining…" : "Decline"}
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => decide("approve")}
          disabled={busy !== null}
        >
          <I name="check" size={12} /> {busy === "approve" ? "Approving…" : "Approve"}
        </button>
      </div>
      <button
        className="btn btn-ghost btn-sm"
        onClick={onArchive}
        disabled={archiving}
        style={{ marginTop: 4 }}
        title="Archive without recording a decision"
      >
        Archive
      </button>
      {archiveErr && <span className="tiny" style={{ color: "var(--neg)" }}>{archiveErr}</span>}
    </div>
  );
}

// ─── routine ──────────────────────────────────────────────────────────

function RoutineActions({ g, onRefetch, archiving, onArchive, archiveErr }: Props) {
  const [busy, setBusy] = useState<"toggle" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isPaused = g.status === "paused";
  const fire = g.cron_expr ? nextCronFire(g.cron_expr) : null;

  const toggle = async (): Promise<void> => {
    if (busy) return;
    setBusy("toggle");
    setErr(null);
    try {
      await api.patchGoal(g.id, {
        status: isPaused ? "active" : "paused",
      });
      onRefetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="gactions" style={{ flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      {g.cron_expr && (
        <div style={{ textAlign: "right" }}>
          <div className="tiny mono" style={{ color: "var(--muted)" }}>NEXT FIRE</div>
          <div className="num" style={{ fontSize: 15, fontWeight: 500 }}>
            {isPaused ? "paused" : fire ? fire.label : "scheduled"}
          </div>
          <div className="tiny" style={{ color: "var(--ink-2)" }}>
            {describeCron(g.cron_expr)}
          </div>
        </div>
      )}
      <div className="stack-h">
        <button
          className="btn btn-sm"
          onClick={toggle}
          disabled={busy !== null || g.status === "archived"}
        >
          {busy === "toggle"
            ? "Saving…"
            : isPaused
            ? "Resume routine"
            : "Pause routine"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onArchive}
          disabled={archiving || g.status === "archived"}
          title="Stop this routine for good"
        >
          {archiving ? "Archiving…" : g.status === "archived" ? "Archived" : "End it"}
        </button>
      </div>
      {err && <span className="tiny" style={{ color: "var(--neg)" }}>{err}</span>}
      {archiveErr && <span className="tiny" style={{ color: "var(--neg)" }}>{archiveErr}</span>}
    </div>
  );
}

// ─── ephemeral ────────────────────────────────────────────────────────

function EphemeralActions({ g, onRefetch, archiving, onArchive, archiveErr }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const done = g.status === "achieved";

  const markDone = async (): Promise<void> => {
    if (busy || done) return;
    setBusy(true);
    setErr(null);
    try {
      await api.patchGoal(g.id, { status: "achieved", progress: 100 });
      onRefetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gactions" style={{ flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      {g.due_at && (
        <div style={{ textAlign: "right" }}>
          <div className="tiny mono" style={{ color: "var(--muted)" }}>DUE</div>
          <div className="num" style={{ fontSize: 15, fontWeight: 500 }}>
            {dueLabel(g.due_at)}
          </div>
        </div>
      )}
      <div className="stack-h">
        <button
          className="btn btn-primary btn-sm"
          onClick={markDone}
          disabled={busy || done || g.status === "archived"}
        >
          <I name="check" size={12} /> {done ? "Done" : busy ? "Saving…" : "Mark done"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onArchive}
          disabled={archiving || g.status === "archived"}
        >
          {archiving ? "Archiving…" : g.status === "archived" ? "Archived" : "Archive"}
        </button>
      </div>
      {err && <span className="tiny" style={{ color: "var(--neg)" }}>{err}</span>}
      {archiveErr && <span className="tiny" style={{ color: "var(--neg)" }}>{archiveErr}</span>}
    </div>
  );
}

// ─── standing ─────────────────────────────────────────────────────────

function StandingActions({ g, archiving, onArchive, archiveErr }: Props) {
  const rollup = computeKrRollup(g.key_results ?? []);
  return (
    <div className="gactions" style={{ flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      <div style={{ textAlign: "right" }}>
        <div className="tiny mono" style={{ color: "var(--muted)" }}>KR ROLLUP</div>
        <div className="num" style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em" }}>
          {rollup.label}
        </div>
        <div className="tiny" style={{ color: "var(--ink-2)" }}>
          {g.key_results.length} key result{g.key_results.length === 1 ? "" : "s"}
        </div>
      </div>
      <button
        className="btn btn-sm"
        onClick={onArchive}
        disabled={archiving || g.status === "archived"}
      >
        {archiving ? "Archiving…" : g.status === "archived" ? "Archived" : "Archive goal"}
      </button>
      {archiveErr && <span className="tiny" style={{ color: "var(--neg)" }}>{archiveErr}</span>}
    </div>
  );
}

function computeKrRollup(krs: KeyResult[]): { label: string } {
  if (krs.length === 0) return { label: "—" };
  let totalWeight = 0;
  let weighted = 0;
  for (const k of krs) {
    const t = k.target_value ? Number.parseFloat(k.target_value) : NaN;
    const c = k.current_value ? Number.parseFloat(k.current_value) : NaN;
    if (!Number.isFinite(t) || !Number.isFinite(c) || t <= 0) continue;
    const pct = Math.max(0, Math.min(100, (c / t) * 100));
    const w = k.weight ?? 1;
    totalWeight += w;
    weighted += pct * w;
  }
  if (totalWeight === 0) return { label: "—" };
  const avg = Math.round(weighted / totalWeight);
  return { label: `${avg}%` };
}
