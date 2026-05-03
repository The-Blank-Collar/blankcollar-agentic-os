import type { GoalWithDetail, KeyResult, Run } from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";
import { dueLabel, progressPercent, relativeTime, runDot, statusDot, statusLabel } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { Empty, ErrorState, Loading } from "../components/States";

type Props = { goalId: string | null };

export function GoalDetail({ goalId }: Props) {
  if (!goalId) {
    return (
      <div className="page">
        <Empty title="No goal selected." hint="Open one from the Goals list." />
      </div>
    );
  }
  return <GoalDetailInner goalId={goalId} />;
}

function GoalDetailInner({ goalId }: { goalId: string }) {
  const goalQ = useFetch<GoalWithDetail>(() => api.getGoal(goalId), [goalId]);
  const runsQ = useFetch<Run[]>(() => api.listRuns({ goalId }), [goalId]);

  if (goalQ.loading) {
    return (
      <div className="page">
        <Loading label="Loading goal…" />
      </div>
    );
  }
  if (goalQ.error) {
    return (
      <div className="page">
        <ErrorState error={goalQ.error} onRetry={goalQ.refetch} />
      </div>
    );
  }
  const g = goalQ.data;
  if (!g) {
    return (
      <div className="page">
        <Empty title="Goal not found." />
      </div>
    );
  }

  const pct = progressPercent(g);
  const runs = runsQ.data ?? [];

  const onCancelRun = async (runId: string): Promise<void> => {
    try {
      await api.cancelRun(runId);
      runsQ.refetch();
    } catch (err) {
      console.warn("cancel failed", err);
    }
  };

  return (
    <div className="page">
      <div className="gd-hero">
        <div>
          <div className="gid">
            {g.id.slice(0, 8)} · {g.kind} · {statusLabel(g.status)}
          </div>
          <div className="editorial-eyebrow" style={{ marginBottom: 14 }}>
            {g.kind === "decision" ? "Decision goal" : `${capitalize(g.kind)} objective`}
          </div>
          <div className="gtt">{g.title}</div>
          {g.description && (
            <div className="small" style={{ maxWidth: 620, marginTop: 12, color: "var(--ink-2)" }}>
              {g.description}
            </div>
          )}
        </div>
        <div className="gactions">
          <button className="btn btn-sm" disabled title="Comments arrive in S4">
            <I name="msg" size={12} /> Comment
          </button>
          <button className="btn btn-sm" disabled title="Briefings arrive in S4">
            <I name="play" size={12} /> Briefing
          </button>
          <button className="btn btn-primary btn-sm" disabled title="Editing arrives in S4">
            Adjust target
          </button>
        </div>
      </div>

      <div className="gd-sub">
        <div className="cell">
          <div className="lbl">Progress</div>
          <div className="val num" style={{ fontSize: 22, letterSpacing: "-0.02em" }}>
            {pct}%
          </div>
          <div className="progressbar" style={{ marginTop: 8 }}>
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="cell">
          <div className="lbl">Target</div>
          <div className="val num" style={{ fontSize: 16 }}>
            {g.target_value ?? "—"}
          </div>
          <div className="tiny" style={{ marginTop: 4 }}>by {dueLabel(g.due_at)}</div>
        </div>
        <div className="cell">
          <div className="lbl">Current</div>
          <div className="val num" style={{ fontSize: 16 }}>
            {g.actual_value ?? "—"}
          </div>
          {g.delta_label && (
            <div className="tiny" style={{ marginTop: 4 }}>{g.delta_label}</div>
          )}
        </div>
        <div className="cell">
          <div className="lbl">Owner</div>
          <div className="val">
            {g.owner_id ? <span className="mono tiny">{g.owner_id.slice(0, 8)}</span> : "—"}
          </div>
          <div className="tiny" style={{ marginTop: 4 }}>
            {g.contributors.length > 0
              ? `${g.contributors.length} contributor${g.contributors.length === 1 ? "" : "s"}`
              : "no contributors"}
          </div>
        </div>
        <div className="cell">
          <div className="lbl">Status</div>
          <div className="val" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`dot ${statusDot(g.status)}`} />
            <span style={{ textTransform: "capitalize" }}>{statusLabel(g.status)}</span>
          </div>
          <div className="tiny" style={{ marginTop: 4 }}>updated {relativeTime(g.updated_at)}</div>
        </div>
      </div>

      <div className="gd-grid">
        <div className="left">
          <div className="section">
            <div className="section-head">
              <div className="stack-h">
                <span className="title">Key results</span>
                <span className="pill">{g.key_results.length}</span>
              </div>
              <button className="btn btn-ghost btn-sm" disabled title="Editing arrives in S3">
                <I name="plus" size={12} /> Add
              </button>
            </div>
            {g.key_results.length === 0 ? (
              <div className="empty-hint">
                No key results yet. The KR composer arrives in S3.
              </div>
            ) : (
              <div className="kr-list">
                {g.key_results.map((k) => <KeyResultRow key={k.id} kr={k} />)}
              </div>
            )}
          </div>

          <div className="section">
            <div className="section-head">
              <div className="stack-h">
                <span className="title">Heartbeat</span>
                <span className="tiny mono">live runs · auto</span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={runsQ.refetch}>
                <I name="spark" size={12} /> Refresh
              </button>
            </div>
            {runsQ.loading && <Loading label="Loading runs…" />}
            {runsQ.error && <ErrorState error={runsQ.error} onRetry={runsQ.refetch} />}
            {!runsQ.loading && !runsQ.error && runs.length === 0 && (
              <div className="empty-hint">No runs yet for this goal.</div>
            )}
            {!runsQ.loading && !runsQ.error && runs.length > 0 && (
              <div className="hbtl">
                {groupRunsByDay(runs).map((day) => (
                  <div key={day.date} className="day">
                    <div className="date">{day.date}</div>
                    <div className="events">
                      {day.runs.map((r) => (
                        <RunRow key={r.id} run={r} onCancel={onCancelRun} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="right">
          <div className="rail-section">
            <div className="eyebrow" style={{ marginBottom: 10 }}>Working on this</div>
            {g.contributors.length === 0 ? (
              <div className="tiny" style={{ color: "var(--muted)" }}>No contributors yet.</div>
            ) : (
              g.contributors.map((c, i) => (
                <div
                  key={`${c.agent_id ?? c.user_id ?? i}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 0",
                    borderTop: i ? "1px solid var(--line)" : 0,
                  }}
                >
                  <div className="sigil" style={{ width: 24, height: 24 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13 }}>
                      {c.agent_id ? "Agent" : c.user_id ? "User" : "Unknown"}
                    </div>
                    <div className="tiny mono">
                      {(c.agent_id ?? c.user_id ?? "").slice(0, 8)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rail-section">
            <div className="eyebrow" style={{ marginBottom: 10 }}>Goal metadata</div>
            <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.6 }}>
              <Meta k="kind" v={g.kind} />
              <Meta k="status" v={g.status} />
              {g.cron_expr && <Meta k="cron" v={g.cron_expr} />}
              <Meta k="created" v={relativeTime(g.created_at)} />
              <Meta k="updated" v={relativeTime(g.updated_at)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const Meta = ({ k, v }: { k: string; v: string }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderTop: "1px solid var(--line)" }}>
    <span className="tiny mono" style={{ color: "var(--muted)" }}>{k}</span>
    <span className="tiny mono">{v}</span>
  </div>
);

const KeyResultRow = ({ kr }: { kr: KeyResult }) => {
  const target = kr.target_value ? Number.parseFloat(kr.target_value) : NaN;
  const current = kr.current_value ? Number.parseFloat(kr.current_value) : NaN;
  const pct = Number.isFinite(target) && Number.isFinite(current) && target > 0
    ? Math.min(100, Math.round((current / target) * 100))
    : 0;
  return (
    <div className="kr">
      <div>
        <div className="ktitle">{kr.label}</div>
        <div className="ksub">
          {kr.unit ? `${kr.unit} · ` : ""}
          {kr.due_at ? `due ${dueLabel(kr.due_at)}` : "no deadline"}
        </div>
      </div>
      <div className="kbar">
        <div className="progressbar" style={{ flex: 1 }}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="num" style={{ width: 40, textAlign: "right" }}>{pct}%</span>
      </div>
      <div className="kval">
        <div>
          {kr.current_value ?? "—"}{" "}
          <span style={{ color: "var(--muted)" }}>/ {kr.target_value ?? "—"}</span>
        </div>
      </div>
    </div>
  );
};

const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function groupRunsByDay(runs: Run[]): { date: string; runs: Run[] }[] {
  const groups = new Map<string, Run[]>();
  for (const r of runs) {
    const d = new Date(r.created_at);
    const key = Number.isNaN(d.getTime())
      ? r.created_at
      : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return Array.from(groups, ([date, items]) => ({ date, runs: items }));
}

const RunRow = ({ run, onCancel }: { run: Run; onCancel: (id: string) => void }) => {
  const cancellable = run.status === "queued" || run.status === "running";
  return (
    <div className="hbev">
      <div className={`marker ${runDot(run.status)}`} />
      <div className="body">
        <b>Run {run.id.slice(0, 8)}</b>{" "}
        <span className="by">· {run.status}</span>
        {run.error && (
          <div className="quote" style={{ borderLeftColor: "var(--neg)" }}>{run.error}</div>
        )}
        {run.output && Object.keys(run.output).length > 0 && (
          <div className="quote">{JSON.stringify(run.output).slice(0, 280)}</div>
        )}
      </div>
      <div className="when">
        <div>{relativeTime(run.created_at)}</div>
        {cancellable && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 4 }}
            onClick={() => onCancel(run.id)}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};
