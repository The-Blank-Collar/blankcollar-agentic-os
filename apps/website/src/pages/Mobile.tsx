import { useState } from "react";

import type {
  AgentSummary,
  BriefingRow,
  Goal,
  GoalWithDetail,
  InboxItem,
  InboxSummary,
} from "@blankcollar/shared";

import { I, Sigil } from "../icons";
import { api } from "../lib/api";
import { progressPercent, relativeTime } from "../lib/format";
import { useFetch } from "../lib/useFetch";

/**
 * Mobile read view (P4.5).
 *
 * A focused phone-shaped surface — briefing prose, what wants you,
 * active goals, live agents, recent activity. Tap a goal to drill in.
 * Capture-first composer is the only write path; everything else is
 * read-only by design (mobile is for awareness, not management).
 *
 * Two screens, no router: list view + goal detail. The phone frame is
 * inline-styled so we don't drift on a separate stylesheet.
 */

type Props = {
  /** Open the capture composer (mounted at app level). */
  onCapture: () => void;
};

export function Mobile({ onCapture }: Props) {
  const [goalId, setGoalId] = useState<string | null>(null);
  return (
    <div className="mobile-stage" style={{ alignItems: "flex-start", padding: "24px 16px", overflowY: "auto" }}>
      <PhoneFrame>
        {goalId ? (
          <MobileGoalDetail goalId={goalId} onBack={() => setGoalId(null)} />
        ) : (
          <MobileList onOpenGoal={(id) => setGoalId(id)} onCapture={onCapture} />
        )}
      </PhoneFrame>
    </div>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 412,
        maxWidth: "100%",
        minHeight: 760,
        margin: "0 auto",
        border: "1px solid var(--line)",
        borderRadius: 32,
        background: "var(--bg)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.18)",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
}

// ─── list screen ──────────────────────────────────────────────────────

function MobileList({
  onOpenGoal,
  onCapture,
}: {
  onOpenGoal: (id: string) => void;
  onCapture: () => void;
}) {
  const briefingQ = useFetch<BriefingRow>(() => api.getBriefingToday(), []);
  const inboxQ = useFetch<InboxItem[]>(() => api.listInbox({ limit: 4 }), []);
  const inboxSumQ = useFetch<InboxSummary>(() => api.inboxSummary(), []);
  const liveGoalsQ = useFetch<Goal[]>(() => api.listGoals({ status: "active", limit: 6 }), []);
  const agentsQ = useFetch<AgentSummary[]>(() => api.listAgents({ isActive: true }), []);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const urgent = inboxSumQ.data?.urgent ?? 0;
  const total = inboxSumQ.data?.total ?? 0;
  const hint =
    urgent === 0 && total === 0
      ? "Nothing wants you. Quiet day."
      : urgent === 0
      ? `${total} item${total === 1 ? "" : "s"} in your inbox.`
      : `${urgent} of ${total} are urgent.`;

  return (
    <>
      <div
        style={{
          flexShrink: 0,
          padding: "20px 22px 14px",
          borderBottom: "1px solid var(--line)",
          background: "var(--bg-1)",
        }}
      >
        <div className="editorial-eyebrow" style={{ fontSize: 10.5, marginBottom: 6 }}>
          Today · {today}
        </div>
        <div className="serif" style={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em" }}>
          Good {timeOfDay()}.
        </div>
        <div className="small" style={{ marginTop: 4, color: "var(--ink-2)" }}>{hint}</div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 100px" }}>
        <SectionH label="Briefing" />
        <BriefingPanel q={briefingQ} />

        <SectionH label="Wants you" sub={total > 0 ? `${total}` : undefined} />
        {inboxQ.loading && !inboxQ.data ? (
          <Hint>Reading inbox…</Hint>
        ) : inboxQ.error ? (
          <Hint tone="neg">{inboxQ.error.message}</Hint>
        ) : (inboxQ.data ?? []).length === 0 ? (
          <Hint>All clear.</Hint>
        ) : (
          (inboxQ.data ?? []).map((it, i) => (
            <button
              key={`${it.goal_id}-${i}`}
              type="button"
              onClick={() => onOpenGoal(it.goal_id)}
              style={tapRow}
            >
              <div className="sigil" style={{ width: 30, height: 30 }}>
                <Sigil seed={it.goal_id} size={28} />
              </div>
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{it.title}</div>
                <div className="tiny" style={{ marginTop: 2 }}>
                  {it.urgency === "urgent" ? "Urgent · " : ""}
                  {labelForKind(it.item_kind)} · {relativeTime(it.created_at)}
                </div>
              </div>
              <I name="chev" size={14} />
            </button>
          ))
        )}

        <SectionH label="In flight" sub={liveGoalsQ.data ? String(liveGoalsQ.data.length) : undefined} />
        {liveGoalsQ.loading && !liveGoalsQ.data ? (
          <Hint>Loading goals…</Hint>
        ) : liveGoalsQ.error ? (
          <Hint tone="neg">{liveGoalsQ.error.message}</Hint>
        ) : (liveGoalsQ.data ?? []).length === 0 ? (
          <Hint>No active goals — capture one below.</Hint>
        ) : (
          (liveGoalsQ.data ?? []).map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onOpenGoal(g.id)}
              style={tapRow}
            >
              <div className="sigil" style={{ width: 30, height: 30 }}>
                <Sigil seed={g.id} size={28} />
              </div>
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{g.title}</div>
                <div className="tiny" style={{ marginTop: 2 }}>
                  {g.kind} · {progressPercent(g)}%
                </div>
              </div>
              <I name="chev" size={14} />
            </button>
          ))
        )}

        <SectionH label="Live now" sub={agentsQ.data ? String(agentsQ.data.length) : undefined} />
        {agentsQ.loading && !agentsQ.data ? (
          <Hint>Reading roster…</Hint>
        ) : (agentsQ.data ?? []).length === 0 ? (
          <Hint>No agents online.</Hint>
        ) : (
          (agentsQ.data ?? []).slice(0, 5).map((a) => (
            <div key={a.id} style={agentRow}>
              <div className="sigil" style={{ width: 26, height: 26 }}>
                <Sigil seed={a.id} size={24} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13 }}>{a.name}</div>
                <div className="tiny" style={{ color: "var(--muted)" }}>{a.kind}</div>
              </div>
              <span className={`dot ${a.is_active ? "live" : "idle"}`} />
            </div>
          ))
        )}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "12px 16px 18px",
          background: "linear-gradient(180deg, transparent 0%, var(--bg) 28%)",
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={onCapture}
          style={{
            pointerEvents: "auto",
            borderRadius: 999,
            padding: "12px 22px",
            fontSize: 14,
            boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
          }}
        >
          <I name="plus" size={14} /> Capture
        </button>
      </div>
    </>
  );
}

// ─── goal detail screen ───────────────────────────────────────────────

function MobileGoalDetail({ goalId, onBack }: { goalId: string; onBack: () => void }) {
  const goalQ = useFetch<GoalWithDetail>(() => api.getGoal(goalId), [goalId]);
  return (
    <>
      <div
        style={{
          flexShrink: 0,
          padding: "16px 18px",
          borderBottom: "1px solid var(--line)",
          background: "var(--bg-1)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onBack}
          style={{ padding: "4px 10px" }}
        >
          ← Back
        </button>
        <span className="tiny mono" style={{ color: "var(--muted)" }}>
          {goalId.slice(0, 8)}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px 60px" }}>
        {goalQ.loading && !goalQ.data && <Hint>Loading…</Hint>}
        {goalQ.error && <Hint tone="neg">{goalQ.error.message}</Hint>}
        {goalQ.data && <MobileGoalBody g={goalQ.data} />}
      </div>
    </>
  );
}

function MobileGoalBody({ g }: { g: GoalWithDetail }) {
  const pct = progressPercent(g);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div className="editorial-eyebrow" style={{ fontSize: 10.5, marginBottom: 6 }}>
          {g.kind} · {g.status}
        </div>
        <div
          className="serif"
          style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.2, letterSpacing: "-0.01em" }}
        >
          {g.title}
        </div>
        {g.description && (
          <div className="small" style={{ marginTop: 8, color: "var(--ink-2)", lineHeight: 1.55 }}>
            {g.description}
          </div>
        )}
      </div>

      {g.kind !== "decision" && (
        <div>
          <div className="tiny mono" style={{ color: "var(--muted)" }}>PROGRESS</div>
          <div className="num" style={{ fontSize: 22, fontWeight: 500 }}>{pct}%</div>
          <div className="progressbar" style={{ marginTop: 6 }}>
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {g.kind === "routine" && g.cron_expr && (
        <div className="rail-section" style={{ padding: 12 }}>
          <div className="tiny mono" style={{ color: "var(--muted)" }}>SCHEDULE</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{g.cron_expr}</div>
        </div>
      )}

      {g.due_at && (
        <div className="rail-section" style={{ padding: 12 }}>
          <div className="tiny mono" style={{ color: "var(--muted)" }}>DUE</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {new Date(g.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>
      )}

      {g.key_results.length > 0 && (
        <div>
          <div className="tiny mono" style={{ color: "var(--muted)", marginBottom: 8 }}>
            KEY RESULTS
          </div>
          {g.key_results.map((kr) => {
            const tgt = kr.target_value ? Number.parseFloat(kr.target_value) : NaN;
            const cur = kr.current_value ? Number.parseFloat(kr.current_value) : NaN;
            const krPct =
              Number.isFinite(tgt) && Number.isFinite(cur) && tgt > 0
                ? Math.min(100, Math.round((cur / tgt) * 100))
                : 0;
            return (
              <div
                key={kr.id}
                style={{
                  padding: "10px 12px",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius)",
                  background: "var(--bg-1)",
                  marginBottom: 8,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500 }}>{kr.label}</div>
                <div className="tiny" style={{ marginTop: 4, color: "var(--muted)" }}>
                  {kr.current_value ?? "—"} / {kr.target_value ?? "—"}
                  {kr.unit ? ` ${kr.unit}` : ""} · {krPct}%
                </div>
                <div className="progressbar" style={{ marginTop: 6 }}>
                  <i style={{ width: `${krPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 4 }}>
        created {relativeTime(g.created_at)} · updated {relativeTime(g.updated_at)}
      </div>

      <div
        className="tiny"
        style={{
          marginTop: 8,
          padding: 12,
          border: "1px dashed var(--line)",
          borderRadius: "var(--radius)",
          color: "var(--muted)",
          textAlign: "center",
        }}
      >
        Mobile is a read view. Open the desktop console to act on this goal.
      </div>
    </div>
  );
}

// ─── briefing panel (compact, mobile) ─────────────────────────────────

function BriefingPanel({
  q,
}: {
  q: { data: BriefingRow | null; error: Error | null; loading: boolean };
}) {
  if (q.loading && !q.data) return <Hint>Drafting today's briefing…</Hint>;
  if (q.error) return <Hint tone="neg">{q.error.message}</Hint>;
  if (!q.data) return null;
  // Take just the opening paragraph; reading the full thing belongs on desktop.
  const opening = q.data.summary_md.split("\n\n")[0]?.trim() ?? "";
  return (
    <div
      style={{
        padding: 14,
        border: "1px solid var(--line)",
        borderLeft: "2px solid var(--ink-2)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-1)",
        marginBottom: 14,
      }}
    >
      <div className="serif" style={{ fontSize: 15, lineHeight: 1.5, color: "var(--ink)" }}>
        {opening}
      </div>
      <div className="tiny mono" style={{ marginTop: 8, color: "var(--muted)" }}>
        {relativeTime(q.data.generated_at)}
      </div>
    </div>
  );
}

// ─── tiny helpers ─────────────────────────────────────────────────────

function SectionH({ label, sub }: { label: string; sub?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginTop: 14,
        marginBottom: 6,
      }}
    >
      <span className="eyebrow" style={{ fontSize: 10.5 }}>{label}</span>
      {sub && (
        <span className="tiny mono" style={{ color: "var(--muted)" }}>{sub}</span>
      )}
    </div>
  );
}

function Hint({ children, tone }: { children: React.ReactNode; tone?: "neg" }) {
  return (
    <div
      className="empty-hint"
      style={{
        margin: 0,
        padding: 12,
        textAlign: "left",
        color: tone === "neg" ? "var(--neg)" : "var(--muted)",
        fontSize: 12.5,
      }}
    >
      {children}
    </div>
  );
}

function timeOfDay(): string {
  const h = new Date().getHours();
  if (h < 5) return "evening";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

function labelForKind(k: InboxItem["item_kind"]): string {
  switch (k) {
    case "approval":       return "Approval";
    case "decision":       return "Decision";
    case "blocked":        return "Blocked";
    case "routine_output": return "Routine output";
    case "draft":          return "Draft";
  }
}

const tapRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "10px 12px",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius)",
  background: "var(--bg-1)",
  cursor: "pointer",
  marginBottom: 8,
  fontFamily: "inherit",
  color: "inherit",
};

const agentRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 4px",
  borderTop: "1px solid var(--line)",
};
