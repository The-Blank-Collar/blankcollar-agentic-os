import React, { useState } from "react";

import type {
  GoalContext,
  GoalMemoryEntry,
  GoalWithDetail,
  KeyResult,
  KeyResultCreate,
  Run,
  SubtaskRow,
  SubtaskStatus,
} from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";
import { describeCron, nextCronFire } from "../lib/cron";
import { dueLabel, progressPercent, relativeTime, runDot, statusDot, statusLabel } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { Empty, ErrorState, Loading } from "../components/States";
import { GoalKindActions } from "../components/GoalKindActions";
import { RunDrilldown } from "../components/RunDrilldown";

type Props = {
  goalId: string | null;
  onAfterArchive?: () => void;
};

export function GoalDetail({ goalId, onAfterArchive }: Props) {
  if (!goalId) {
    return (
      <div className="page">
        <Empty title="No goal selected." hint="Open one from the Goals list." />
      </div>
    );
  }
  return <GoalDetailInner goalId={goalId} onAfterArchive={onAfterArchive} />;
}

function GoalDetailInner({
  goalId,
  onAfterArchive,
}: {
  goalId: string;
  onAfterArchive?: () => void;
}) {
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

  const [archiving, setArchiving] = useState(false);
  const [archiveErr, setArchiveErr] = useState<string | null>(null);
  const [drilldownRunId, setDrilldownRunId] = useState<string | null>(null);

  const onArchive = async (): Promise<void> => {
    if (archiving) return;
    const ok = window.confirm(
      "Archive this goal? It hides from active views; runs + key results stay in the audit log.",
    );
    if (!ok) return;
    setArchiving(true);
    setArchiveErr(null);
    try {
      await api.archiveGoal(goalId);
      onAfterArchive?.();
    } catch (err) {
      setArchiveErr(err instanceof Error ? err.message : String(err));
      setArchiving(false);
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
            {kindEyebrow(g.kind)}
          </div>
          <div className="gtt">{g.title}</div>
          {g.description && (
            <div className="small" style={{ maxWidth: 620, marginTop: 12, color: "var(--ink-2)" }}>
              {g.description}
            </div>
          )}
        </div>
        <GoalKindActions
          g={g}
          archiving={archiving}
          archiveErr={archiveErr}
          onArchive={onArchive}
          onRefetch={goalQ.refetch}
        />
      </div>

      <KindSubStrip g={g} pct={pct} runs={runs} />

      {archiveErr && (
        <div
          style={{
            margin: "12px var(--pad-x) 0",
            padding: 10,
            border: "1px solid var(--line)",
            borderLeft: "2px solid var(--neg)",
            borderRadius: "var(--radius)",
            background: "var(--bg-1)",
            fontSize: 12.5,
            color: "var(--ink-2)",
          }}
        >
          <span className="mono" style={{ color: "var(--neg)", marginRight: 8 }}>
            ARCHIVE FAILED
          </span>
          {archiveErr}
        </div>
      )}

      <div className="gd-grid">
        <div className="left">
          {g.kind === "decision" && <DecisionReasoning g={g} />}

          <GoalContextSection goalId={g.id} />

          <GoalMemorySection goalId={g.id} runs={runs} />

          {(g.kind === "standing" || g.key_results.length > 0) && (
            <KeyResultsSection
              goalId={g.id}
              keyResults={g.key_results}
              onChanged={goalQ.refetch}
            />
          )}

          {(g.kind === "ephemeral" || g.kind === "standing") && (
            <SwarmSection goalId={g.id} />
          )}


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
                        <RunRow
                          key={r.id}
                          run={r}
                          onCancel={onCancelRun}
                          onOpen={() => setDrilldownRunId(r.id)}
                        />
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

      {drilldownRunId && (
        <RunDrilldown
          runId={drilldownRunId}
          onClose={() => {
            setDrilldownRunId(null);
            runsQ.refetch();
          }}
        />
      )}
    </div>
  );
}

const Meta = ({ k, v }: { k: string; v: string }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderTop: "1px solid var(--line)" }}>
    <span className="tiny mono" style={{ color: "var(--muted)" }}>{k}</span>
    <span className="tiny mono">{v}</span>
  </div>
);

const KeyResultsSection = ({
  goalId,
  keyResults,
  onChanged,
}: {
  goalId: string;
  keyResults: KeyResult[];
  onChanged: () => void;
}) => {
  const [composing, setComposing] = useState(false);
  return (
    <div className="section">
      <div className="section-head">
        <div className="stack-h">
          <span className="title">Key results</span>
          <span className="pill">{keyResults.length}</span>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setComposing((c) => !c)}
        >
          <I name="plus" size={12} /> {composing ? "Cancel" : "Add"}
        </button>
      </div>

      {composing && (
        <KrComposer
          goalId={goalId}
          onSaved={() => {
            setComposing(false);
            onChanged();
          }}
          onCancel={() => setComposing(false)}
        />
      )}

      {keyResults.length === 0 && !composing ? (
        <div className="empty-hint">
          No key results yet. Click <span className="mono">Add</span> to create one.
        </div>
      ) : (
        <div className="kr-list">
          {keyResults.map((k) => (
            <KeyResultRow key={k.id} kr={k} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
};

const KeyResultRow = ({ kr, onChanged }: { kr: KeyResult; onChanged: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const target = kr.target_value ? Number.parseFloat(kr.target_value) : NaN;
  const current = kr.current_value ? Number.parseFloat(kr.current_value) : NaN;
  const pct = Number.isFinite(target) && Number.isFinite(current) && target > 0
    ? Math.min(100, Math.round((current / target) * 100))
    : 0;

  const onDelete = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.deleteKeyResult(kr.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="kr">
      <div>
        <div className="ktitle">{kr.label}</div>
        <div className="ksub">
          {kr.unit ? `${kr.unit} · ` : ""}
          {kr.due_at ? `due ${dueLabel(kr.due_at)}` : "no deadline"}
        </div>
        {err && <div className="tiny" style={{ color: "var(--neg)", marginTop: 4 }}>{err}</div>}
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
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 6, opacity: 0.7 }}
          onClick={onDelete}
          disabled={busy}
          title="Delete key result"
        >
          {busy ? "…" : "Delete"}
        </button>
      </div>
    </div>
  );
};

const KrComposer = ({
  goalId,
  onSaved,
  onCancel,
}: {
  goalId: string;
  onSaved: () => void;
  onCancel: () => void;
}) => {
  const [form, setForm] = useState<{
    label: string;
    target_value: string;
    current_value: string;
    unit: string;
  }>({ label: "", target_value: "", current_value: "", unit: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!form.label.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const body: KeyResultCreate = {
      label: form.label.trim(),
      target_value: form.target_value.trim() || null,
      current_value: form.current_value.trim() || null,
      unit: form.unit.trim() || null,
    };
    try {
      await api.createKeyResult(goalId, body);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        margin: "12px 0 16px",
        padding: 14,
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-1)",
        display: "grid",
        gap: 10,
      }}
    >
      <input
        autoFocus
        placeholder="What outcome does this measure?"
        value={form.label}
        onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
        style={krInput}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <input
          placeholder="Target (e.g. 100)"
          value={form.target_value}
          onChange={(e) => setForm((f) => ({ ...f, target_value: e.target.value }))}
          style={krInput}
        />
        <input
          placeholder="Current (e.g. 0)"
          value={form.current_value}
          onChange={(e) => setForm((f) => ({ ...f, current_value: e.target.value }))}
          style={krInput}
        />
        <input
          placeholder="Unit (e.g. signups)"
          value={form.unit}
          onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
          style={krInput}
        />
      </div>
      {err && <div className="tiny" style={{ color: "var(--neg)" }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={busy || !form.label.trim()}
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </form>
  );
};

// -- Swarm subtasks (Sprint 5.6) ---------------------------------------------

const SUBTASK_TONE: Record<SubtaskStatus, string> = {
  pending:    "var(--muted-2)",
  ready:      "var(--info)",
  queued:     "var(--info)",
  running:    "var(--info)",
  succeeded:  "var(--pos)",
  failed:     "var(--neg)",
  cancelled:  "var(--muted)",
};

const SwarmSection = ({ goalId }: { goalId: string }) => {
  const subtasksQ = useFetch<SubtaskRow[]>(
    () => api.listSubtasks(goalId),
    [goalId],
  );
  const [busy, setBusy] = useState<"plan" | "dispatch" | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const onPlan = async (): Promise<void> => {
    if (busy) return;
    setBusy("plan");
    setErr(null);
    setWarnings([]);
    try {
      const r = await api.planSwarm(goalId);
      setWarnings(r.warnings);
      await subtasksQ.refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onDispatch = async (): Promise<void> => {
    if (busy) return;
    setBusy("dispatch");
    setErr(null);
    try {
      await api.dispatchSwarm(goalId);
      await subtasksQ.refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onCancel = async (subtaskId: string): Promise<void> => {
    if (busy) return;
    if (!window.confirm("Cancel this subtask? Any dependents will also be cancelled.")) return;
    try {
      await api.cancelSubtask(subtaskId);
      await subtasksQ.refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const subtasks = subtasksQ.data ?? [];
  const hasPlan = subtasks.length > 0;

  return (
    <div className="section">
      <div className="section-head">
        <div className="stack-h">
          <span className="title">Swarm plan</span>
          {hasPlan && <span className="pill">{subtasks.length} step{subtasks.length === 1 ? "" : "s"}</span>}
        </div>
        <div className="stack-h">
          <button className="btn btn-sm" onClick={onPlan} disabled={busy !== null}>
            <I name="spark" size={12} /> {busy === "plan" ? "Planning…" : hasPlan ? "Re-plan" : "Plan with Chief"}
          </button>
          {hasPlan && (
            <button
              className="btn btn-primary btn-sm"
              onClick={onDispatch}
              disabled={busy !== null}
            >
              {busy === "dispatch" ? "Dispatching…" : "Dispatch ready"}
            </button>
          )}
        </div>
      </div>

      {err && (
        <div
          style={{
            margin: "0 0 12px",
            padding: 10,
            border: "1px solid var(--line)",
            borderLeft: "2px solid var(--neg)",
            borderRadius: "var(--radius)",
            background: "var(--bg-1)",
            fontSize: 12.5,
            color: "var(--ink-2)",
          }}
        >
          <span className="mono" style={{ color: "var(--neg)", marginRight: 8 }}>FAILED</span>
          {err}
        </div>
      )}

      {warnings.length > 0 && (
        <div
          style={{
            margin: "0 0 12px",
            padding: 10,
            border: "1px solid var(--line)",
            borderLeft: "2px solid var(--warn)",
            borderRadius: "var(--radius)",
            background: "var(--bg-1)",
            fontSize: 12.5,
            color: "var(--ink-2)",
          }}
        >
          <div className="mono" style={{ color: "var(--warn)", marginBottom: 6 }}>
            {warnings.length} WARNING{warnings.length === 1 ? "" : "S"}
          </div>
          {warnings.map((w, i) => <div key={i} style={{ marginTop: 2 }}>· {w}</div>)}
        </div>
      )}

      {subtasksQ.loading && <Loading label="Loading subtasks…" />}
      {subtasksQ.error && <ErrorState error={subtasksQ.error} onRetry={subtasksQ.refetch} />}
      {!subtasksQ.loading && !subtasksQ.error && subtasks.length === 0 && (
        <div className="empty-hint">
          No swarm plan yet. "Plan with Chief" decomposes the goal into a DAG
          of subtasks; "Dispatch ready" queues the ones whose dependencies
          are clear.
        </div>
      )}
      {!subtasksQ.loading && !subtasksQ.error && subtasks.length > 0 && (
        <SubtaskList subtasks={subtasks} onCancel={onCancel} />
      )}
    </div>
  );
};

const SubtaskList = ({
  subtasks,
  onCancel,
}: {
  subtasks: SubtaskRow[];
  onCancel: (id: string) => void;
}) => {
  // Build a map of id → ordinal for friendlier dep labels.
  const ordinalById = new Map(subtasks.map((s) => [s.id, s.ordinal]));
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {subtasks.map((s, i) => {
        const tone = SUBTASK_TONE[s.status];
        const cancellable =
          s.status === "pending" ||
          s.status === "ready" ||
          s.status === "queued" ||
          s.status === "running";
        return (
          <div
            key={s.id}
            style={{
              padding: "14px 18px",
              borderTop: i ? "1px solid var(--line)" : 0,
              display: "grid",
              gridTemplateColumns: "auto 32px 1fr auto",
              gap: 12,
              alignItems: "flex-start",
            }}
          >
            <span
              style={{
                width: 6,
                alignSelf: "stretch",
                background: tone,
                borderRadius: 2,
                minHeight: 36,
              }}
            />
            <span
              className="num"
              style={{
                fontSize: 13,
                color: "var(--muted)",
                paddingTop: 2,
              }}
            >
              {s.ordinal}
            </span>
            <div>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{s.title}</span>
                <span
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: tone,
                  }}
                >
                  {s.status}
                </span>
              </div>
              <div className="small" style={{ color: "var(--ink-2)", maxWidth: 720, lineHeight: 1.5 }}>
                {s.instruction}
              </div>
              <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 6 }}>
                {s.agent_kind}
                {s.skill_slug && ` · skill=${s.skill_slug}`}
                {s.depends_on.length > 0 && (
                  <>
                    {" · depends on "}
                    {s.depends_on
                      .map((id) => ordinalById.get(id) ?? "?")
                      .join(", ")}
                  </>
                )}
                {s.run_id && (
                  <>
                    {" · "}
                    <span>run {s.run_id.slice(0, 8)}</span>
                  </>
                )}
              </div>
              {s.error && (
                <div
                  className="tiny"
                  style={{
                    marginTop: 6,
                    color: "var(--neg)",
                    fontFamily: "var(--font-mono)",
                    wordBreak: "break-word",
                  }}
                >
                  error: {s.error}
                </div>
              )}
            </div>
            <div>
              {cancellable && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onCancel(s.id)}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const krInput: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  outline: "none",
};

function kindEyebrow(kind: GoalWithDetail["kind"]): string {
  switch (kind) {
    case "decision":  return "Decision · wants your call";
    case "routine":   return "Routine · runs on a schedule";
    case "standing":  return "Standing · measured by KRs";
    case "ephemeral": return "Ephemeral · one-shot";
  }
}

function KindSubStrip({ g, pct, runs }: { g: GoalWithDetail; pct: number; runs: Run[] }) {
  if (g.kind === "decision") {
    return <DecisionSubStrip g={g} runs={runs} />;
  }
  if (g.kind === "routine") {
    return <RoutineSubStrip g={g} runs={runs} />;
  }
  if (g.kind === "standing") {
    return <StandingSubStrip g={g} pct={pct} />;
  }
  return <EphemeralSubStrip g={g} pct={pct} runs={runs} />;
}

function DecisionSubStrip({ g, runs }: { g: GoalWithDetail; runs: Run[] }) {
  const meta = (g.metadata ?? {}) as Record<string, unknown>;
  const decided = g.status === "achieved" || g.status === "archived";
  const decision = (meta.decision as string | undefined) ?? null;
  const decisionAt = (meta.decision_at as string | undefined) ?? null;
  return (
    <div className="gd-sub">
      <div className="cell">
        <div className="lbl">State</div>
        <div className="val" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`dot ${statusDot(g.status)}`} />
          <span style={{ textTransform: "capitalize" }}>
            {decided ? (decision === "approved" ? "Approved" : "Declined") : "Awaiting your call"}
          </span>
        </div>
        <div className="tiny" style={{ marginTop: 4 }}>updated {relativeTime(g.updated_at)}</div>
      </div>
      <div className="cell">
        <div className="lbl">Asked</div>
        <div className="val num" style={{ fontSize: 16 }}>{relativeTime(g.created_at)}</div>
      </div>
      <div className="cell">
        <div className="lbl">Decided</div>
        <div className="val num" style={{ fontSize: 16 }}>
          {decisionAt ? relativeTime(decisionAt) : "—"}
        </div>
      </div>
      <div className="cell">
        <div className="lbl">Source</div>
        <div className="val tiny mono">
          {(meta.source as string | undefined) ?? "manual"}
        </div>
      </div>
      <div className="cell">
        <div className="lbl">Recent runs</div>
        <div className="val num" style={{ fontSize: 16 }}>{runs.length}</div>
      </div>
    </div>
  );
}

function RoutineSubStrip({ g, runs }: { g: GoalWithDetail; runs: Run[] }) {
  const fire = g.cron_expr ? nextCronFire(g.cron_expr) : null;
  const lastSucceeded = runs.find((r) => r.status === "succeeded");
  const succeeded = runs.filter((r) => r.status === "succeeded").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  return (
    <div className="gd-sub">
      <div className="cell">
        <div className="lbl">Schedule</div>
        <div className="val num" style={{ fontSize: 16 }}>
          {g.cron_expr ? describeCron(g.cron_expr) : "—"}
        </div>
        <div className="tiny mono" style={{ marginTop: 4, color: "var(--muted)" }}>
          {g.cron_expr ?? ""}
        </div>
      </div>
      <div className="cell">
        <div className="lbl">Next fire</div>
        <div className="val num" style={{ fontSize: 16 }}>
          {g.status === "paused" ? "paused" : fire ? fire.label : "scheduled"}
        </div>
      </div>
      <div className="cell">
        <div className="lbl">Last fired</div>
        <div className="val num" style={{ fontSize: 16 }}>
          {lastSucceeded ? relativeTime(lastSucceeded.finished_at ?? lastSucceeded.created_at) : "—"}
        </div>
      </div>
      <div className="cell">
        <div className="lbl">Succeeded</div>
        <div className="val num" style={{ fontSize: 16 }}>{succeeded}</div>
        {failed > 0 && (
          <div className="tiny" style={{ marginTop: 4, color: "var(--neg)" }}>{failed} failed</div>
        )}
      </div>
      <div className="cell">
        <div className="lbl">Status</div>
        <div className="val" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`dot ${statusDot(g.status)}`} />
          <span style={{ textTransform: "capitalize" }}>{statusLabel(g.status)}</span>
        </div>
      </div>
    </div>
  );
}

function StandingSubStrip({ g, pct }: { g: GoalWithDetail; pct: number }) {
  const krs = g.key_results;
  return (
    <div className="gd-sub">
      <div className="cell">
        <div className="lbl">Rollup</div>
        <div className="val num" style={{ fontSize: 22, letterSpacing: "-0.02em" }}>{pct}%</div>
        <div className="progressbar" style={{ marginTop: 8 }}>
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="cell">
        <div className="lbl">Key results</div>
        <div className="val num" style={{ fontSize: 16 }}>{krs.length}</div>
        <div className="tiny" style={{ marginTop: 4 }}>
          {krs.length === 0 ? "Add one below" : "Listed below"}
        </div>
      </div>
      <div className="cell">
        <div className="lbl">Target</div>
        <div className="val num" style={{ fontSize: 16 }}>{g.target_value ?? "—"}</div>
        <div className="tiny" style={{ marginTop: 4 }}>by {dueLabel(g.due_at)}</div>
      </div>
      <div className="cell">
        <div className="lbl">Current</div>
        <div className="val num" style={{ fontSize: 16 }}>{g.actual_value ?? "—"}</div>
        {g.delta_label && (
          <div className="tiny" style={{ marginTop: 4 }}>{g.delta_label}</div>
        )}
      </div>
      <div className="cell">
        <div className="lbl">Status</div>
        <div className="val" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`dot ${statusDot(g.status)}`} />
          <span style={{ textTransform: "capitalize" }}>{statusLabel(g.status)}</span>
        </div>
      </div>
    </div>
  );
}

function EphemeralSubStrip({ g, pct, runs }: { g: GoalWithDetail; pct: number; runs: Run[] }) {
  const lastRun = runs[0] ?? null;
  return (
    <div className="gd-sub">
      <div className="cell">
        <div className="lbl">Progress</div>
        <div className="val num" style={{ fontSize: 22, letterSpacing: "-0.02em" }}>{pct}%</div>
        <div className="progressbar" style={{ marginTop: 8 }}>
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="cell">
        <div className="lbl">Due</div>
        <div className="val num" style={{ fontSize: 16 }}>{dueLabel(g.due_at)}</div>
      </div>
      <div className="cell">
        <div className="lbl">Runs</div>
        <div className="val num" style={{ fontSize: 16 }}>{runs.length}</div>
        <div className="tiny" style={{ marginTop: 4 }}>
          {lastRun ? `last ${relativeTime(lastRun.created_at)}` : "no runs yet"}
        </div>
      </div>
      <div className="cell">
        <div className="lbl">Owner</div>
        <div className="val">
          {g.owner_id ? <span className="mono tiny">{g.owner_id.slice(0, 8)}</span> : "—"}
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
  );
}

function DecisionReasoning({ g }: { g: GoalWithDetail }) {
  const meta = (g.metadata ?? {}) as Record<string, unknown>;
  const reasoning = (meta.reasoning as string | undefined)
    ?? (meta.context as string | undefined)
    ?? null;
  const reason = (meta.decision_reason as string | undefined) ?? null;
  if (!g.description && !reasoning && !reason) return null;
  return (
    <div className="section">
      <div className="section-head">
        <div className="stack-h">
          <span className="title">Reasoning</span>
        </div>
      </div>
      <div
        style={{
          padding: "16px 18px",
          border: "1px solid var(--line)",
          borderLeft: "2px solid var(--info)",
          borderRadius: "var(--radius)",
          background: "var(--bg-1)",
          color: "var(--ink-2)",
          fontSize: 14,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}
      >
        {g.description ?? reasoning ?? ""}
      </div>
      {reason && (
        <div
          style={{
            marginTop: 10,
            padding: "12px 14px",
            border: "1px solid var(--line)",
            borderLeft: `2px solid ${g.status === "achieved" ? "var(--pos)" : "var(--neg)"}`,
            borderRadius: "var(--radius)",
            background: "var(--bg-1)",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10.5,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: g.status === "achieved" ? "var(--pos)" : "var(--neg)",
              marginRight: 8,
            }}
          >
            {g.status === "achieved" ? "Approved" : "Declined"}
          </span>
          {reason}
        </div>
      )}
    </div>
  );
}

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

const RunRow = ({
  run,
  onCancel,
  onOpen,
}: {
  run: Run;
  onCancel: (id: string) => void;
  onOpen?: () => void;
}) => {
  const cancellable = run.status === "queued" || run.status === "running";
  return (
    <div
      className="hbev"
      onClick={onOpen}
      style={{ cursor: onOpen ? "pointer" : undefined }}
      title={onOpen ? "Open drilldown" : undefined}
    >
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
      <div className="when" onClick={(e) => e.stopPropagation()}>
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

// -- Goal context (Phase 9.1) --------------------------------------------
// Per-goal markdown blob auto-loaded into every Hermes run. Editing is
// instant — no draft state, no version history, just one Save click. We
// intentionally keep this section lean (one textarea, one button) so the
// memory layer doesn't sprout into its own subapp.

const GOAL_CONTEXT_MAX = 8000;
const GOAL_CONTEXT_SOFT_WARN = 4000;

const GoalContextSection = ({ goalId }: { goalId: string }) => {
  const ctxQ = useFetch<GoalContext>(() => api.getGoalContext(goalId), [goalId]);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Initialise the draft once the first GET resolves; subsequent edits
  // live entirely in `draft` until the user clicks Save.
  React.useEffect(() => {
    if (ctxQ.data && draft === null) {
      setDraft(ctxQ.data.content_md);
    }
  }, [ctxQ.data, draft]);

  const value = draft ?? ctxQ.data?.content_md ?? "";
  const dirty = ctxQ.data ? value !== ctxQ.data.content_md : value.length > 0;
  const overCap = value.length > GOAL_CONTEXT_MAX;
  const soft = value.length >= GOAL_CONTEXT_SOFT_WARN && !overCap;

  const onSave = async (): Promise<void> => {
    if (busy || overCap) return;
    setBusy(true);
    setErr(null);
    try {
      const updated = await api.updateGoalContext(goalId, { content_md: value });
      setDraft(updated.content_md);
      setSavedAt(updated.updated_at);
      ctxQ.refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="section">
      <div className="section-head">
        <div className="stack-h">
          <span className="title">Context</span>
          <span className="tiny mono" style={{ color: "var(--muted)" }}>
            {ctxQ.data?.updated_at && ctxQ.data.content_md
              ? `loaded into every run · updated ${relativeTime(ctxQ.data.updated_at)}`
              : "loaded into every run · empty"}
          </span>
        </div>
        <div className="stack-h">
          <span
            className="tiny mono"
            style={{
              color: overCap ? "var(--neg)" : soft ? "var(--warn)" : "var(--muted)",
            }}
          >
            {value.length} / {GOAL_CONTEXT_MAX}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onSave}
            disabled={busy || overCap || !dirty}
          >
            {busy ? "Saving…" : savedAt && !dirty ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {ctxQ.loading && !ctxQ.data && <Loading label="Loading context…" />}
      {ctxQ.error && <ErrorState error={ctxQ.error} onRetry={ctxQ.refetch} />}

      {ctxQ.data !== null && !ctxQ.error && (
        <>
          <textarea
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Notes the agent should always remember about this goal — audience, tone, banned phrases, key constraints, prior decisions. Markdown welcome."
            rows={8}
            style={{
              width: "100%",
              padding: 14,
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-lg)",
              background: "var(--bg)",
              color: "var(--ink)",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.55,
              resize: "vertical",
              outline: "none",
              minHeight: 160,
            }}
          />
          {err && (
            <div className="tiny" style={{ color: "var(--neg)", marginTop: 6 }}>{err}</div>
          )}
          {soft && (
            <div className="tiny" style={{ color: "var(--warn)", marginTop: 6 }}>
              Long contexts cost tokens on every run. Trim to under {GOAL_CONTEXT_SOFT_WARN.toLocaleString()} chars when you can.
            </div>
          )}
          {overCap && (
            <div className="tiny" style={{ color: "var(--neg)", marginTop: 6 }}>
              Over the {GOAL_CONTEXT_MAX.toLocaleString()}-char cap. Trim before saving.
            </div>
          )}
        </>
      )}
    </div>
  );
};

// -- Goal memory timeline (Phase 9.2) ------------------------------------
// Surfaces brain.memory rows scoped to this goal. Hermes' runner records
// successful runs as `episode` rows; the worker's wrap-up writer records
// non-Hermes successes + failures the same way (kind=fact for failures).
// Read-only — editing the brain is out of scope here.

const MEMORY_KIND_TONE: Record<string, string> = {
  episode:      "var(--info)",
  fact:         "var(--warn)",
  document:     "var(--muted)",
  conversation: "var(--ink-2)",
};

const GoalMemorySection = ({ goalId, runs }: { goalId: string; runs: Run[] }) => {
  const memQ = useFetch<GoalMemoryEntry[]>(
    () => api.listGoalMemory(goalId, { limit: 20 }),
    // Refetch when the run list changes — new run finished → new memory.
    [goalId, runs.length],
  );

  const entries = memQ.data ?? [];

  return (
    <div className="section">
      <div className="section-head">
        <div className="stack-h">
          <span className="title">Memory</span>
          <span className="pill">{entries.length}</span>
        </div>
        <span className="tiny mono" style={{ color: "var(--muted)" }}>
          narrative · auto-recorded after each run
        </span>
      </div>

      {memQ.loading && !memQ.data && <Loading label="Reading the brain…" />}
      {memQ.error && <ErrorState error={memQ.error} onRetry={memQ.refetch} />}

      {!memQ.loading && !memQ.error && entries.length === 0 && (
        <div className="empty-hint">
          No memories yet. As runs complete, summaries land here automatically.
        </div>
      )}

      {entries.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {entries.map((m, i) => {
            const tone = MEMORY_KIND_TONE[m.kind] ?? "var(--muted)";
            const meta = m.metadata ?? {};
            const runStatus = (meta as { run_status?: string }).run_status;
            const agentKind = (meta as { agent_kind?: string }).agent_kind;
            return (
              <div
                key={m.id}
                style={{
                  padding: "12px 16px",
                  borderTop: i ? "1px solid var(--line)" : 0,
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: tone,
                    paddingTop: 2,
                  }}
                >
                  {m.kind}
                </span>
                <div>
                  {m.title && (
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                      {m.title}
                    </div>
                  )}
                  <div
                    className="small"
                    style={{
                      color: "var(--ink-2)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.content}
                  </div>
                  {(runStatus || agentKind) && (
                    <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 6 }}>
                      {agentKind && `agent=${agentKind}`}
                      {agentKind && runStatus && " · "}
                      {runStatus && `status=${runStatus}`}
                    </div>
                  )}
                </div>
                <div className="tiny mono" style={{ color: "var(--muted)" }}>
                  {relativeTime(m.created_at)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
