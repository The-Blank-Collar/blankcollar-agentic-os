import { useEffect, useState } from "react";

import type { Run } from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";
import { relativeTime, runDot } from "../lib/format";

/**
 * Run drilldown modal — debugging surface for a single agent run.
 *
 * Shows the full input/output/error JSON, timing, and a link out to the
 * goal + agent. Open from the Goal Detail heartbeat or from Activity.
 *
 * Refetches the live row on open so the modal always shows the latest
 * state (rather than the truncated snapshot embedded in the parent).
 */

type Props = {
  runId: string;
  onClose: () => void;
  onOpenGoal?: (goalId: string) => void;
};

export function RunDrilldown({ runId, onClose, onOpenGoal }: Props) {
  const [run, setRun] = useState<Run | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCancel, setBusyCancel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api
      .getRun(runId)
      .then((r) => {
        if (!cancelled) {
          setRun(r);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e : new Error(String(e)));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cancellable = run && (run.status === "queued" || run.status === "running");

  const onCancel = async (): Promise<void> => {
    if (!run || busyCancel) return;
    setBusyCancel(true);
    try {
      const updated = await api.cancelRun(run.id);
      setRun(updated);
    } catch (e) {
      setErr(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusyCancel(false);
    }
  };

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div
        className="cmd"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 760, maxHeight: "85vh", display: "flex", flexDirection: "column" }}
        role="dialog"
        aria-label="Run drilldown"
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <I name="spark" size={16} style={{ color: "var(--ink)" }} />
          <span className="eyebrow">Run drilldown</span>
          <span className="tiny mono" style={{ color: "var(--muted)" }}>
            {runId.slice(0, 12)}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: "auto" }}
            onClick={onClose}
            aria-label="Close drilldown"
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && (
            <div style={{ padding: 24 }} className="empty-hint">
              Loading run…
            </div>
          )}
          {err && (
            <div
              style={{
                margin: 18,
                padding: 14,
                border: "1px solid var(--line)",
                borderLeft: "2px solid var(--neg)",
                borderRadius: "var(--radius)",
                background: "var(--bg-1)",
              }}
            >
              <div className="eyebrow" style={{ color: "var(--neg)", marginBottom: 6 }}>
                Couldn't load run
              </div>
              <div className="small">{err.message}</div>
            </div>
          )}

          {run && (
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
              <StatusStrip run={run} />

              <div className="stack-h" style={{ gap: 8 }}>
                {onOpenGoal && (
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      onOpenGoal(run.goal_id);
                      onClose();
                    }}
                  >
                    <I name="arrow" size={11} /> Open goal
                  </button>
                )}
                {cancellable && (
                  <button
                    className="btn btn-sm"
                    onClick={onCancel}
                    disabled={busyCancel}
                  >
                    {busyCancel ? "Cancelling…" : "Cancel run"}
                  </button>
                )}
              </div>

              {run.error && (
                <Block tone="neg" title="Error">
                  <pre style={preStyle}>{run.error}</pre>
                </Block>
              )}

              <Block title="Input">
                <JsonViewer value={run.input} />
              </Block>

              <Block title="Output">
                {run.output && Object.keys(run.output).length > 0 ? (
                  <JsonViewer value={run.output} />
                ) : (
                  <div className="empty-hint" style={{ padding: 12 }}>
                    No output yet
                    {run.status === "running" ? " — still running." : "."}
                  </div>
                )}
              </Block>

              <div className="tiny mono" style={{ color: "var(--muted)", paddingTop: 4 }}>
                run.id={run.id} · goal.id={run.goal_id}
                {run.agent_id ? ` · agent.id=${run.agent_id}` : " · no agent"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusStrip({ run }: { run: Run }) {
  const duration =
    run.started_at && run.finished_at
      ? Math.max(
          0,
          new Date(run.finished_at).getTime() - new Date(run.started_at).getTime(),
        )
      : null;
  const cells: { label: string; value: string; sub?: string }[] = [
    {
      label: "Status",
      value: run.status,
      sub: relativeTime(run.created_at),
    },
    {
      label: "Started",
      value: run.started_at ? relativeTime(run.started_at) : "—",
      sub: run.started_at ?? undefined,
    },
    {
      label: "Finished",
      value: run.finished_at ? relativeTime(run.finished_at) : "—",
      sub: run.finished_at ?? undefined,
    },
    {
      label: "Duration",
      value: duration === null ? "—" : formatDuration(duration),
      sub: duration === null ? undefined : `${duration} ms`,
    },
  ];
  return (
    <div className="gd-sub" style={{ marginTop: 0 }}>
      {cells.map((c, i) => (
        <div key={i} className="cell">
          <div className="lbl">{c.label}</div>
          <div className="val" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            {c.label === "Status" && (
              <span className={`dot ${runDot(run.status)}`} />
            )}
            <span style={{ textTransform: c.label === "Status" ? "capitalize" : "none" }}>
              {c.value}
            </span>
          </div>
          {c.sub && (
            <div
              className="tiny mono"
              style={{ marginTop: 4, color: "var(--muted)", wordBreak: "break-all" }}
            >
              {c.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${(ms / 3_600_000).toFixed(2)} h`;
}

function Block({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "neg";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="section-head" style={{ marginBottom: 6 }}>
        <span className="title" style={{ fontSize: 13 }}>{title}</span>
      </div>
      <div
        style={{
          border: "1px solid var(--line)",
          borderLeft: `2px solid ${tone === "neg" ? "var(--neg)" : "var(--ink-2)"}`,
          borderRadius: "var(--radius)",
          background: "var(--bg-1)",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: "12px 14px",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--ink-2)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 360,
  overflowY: "auto",
};

function JsonViewer({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(value, null, 2);
  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard write may fail in non-secure contexts; ignore silently.
    }
  };
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          fontSize: 11,
          padding: "4px 8px",
          zIndex: 1,
        }}
        onClick={onCopy}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre style={preStyle}>{json}</pre>
    </div>
  );
}
