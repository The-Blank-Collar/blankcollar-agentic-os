import { useMemo, useState, type DragEvent } from "react";

import type { Goal, GoalStatus } from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";
import { dueLabel, progressPercent } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { ErrorState, Loading } from "../components/States";

type ColumnId = "draft" | "active" | "paused" | "achieved";

const COLUMNS: { id: ColumnId; label: string; sub: string; accent: string }[] = [
  { id: "draft",    label: "Backlog",     sub: "queued",        accent: "var(--muted)" },
  { id: "active",   label: "In progress", sub: "agents working", accent: "var(--info)" },
  { id: "paused",   label: "Blocked",     sub: "needs you",      accent: "var(--warn)" },
  { id: "achieved", label: "Done",        sub: "this week",      accent: "var(--pos)" },
];

const COLUMN_IDS = new Set<ColumnId>(["draft", "active", "paused", "achieved"]);

type Props = { onOpenGoal: (id: string) => void };

export function Kanban({ onOpenGoal }: Props) {
  const { data, error, loading, refetch } = useFetch<Goal[]>(
    () => api.listGoals({ limit: 200 }),
    [],
  );
  const [overrides, setOverrides] = useState<Record<string, GoalStatus>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ColumnId | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Effective status per goal: optimistic override wins until refetch returns
  // it (or it gets reverted on error).
  const effective = useMemo(() => {
    const m = new Map<string, Goal>();
    for (const g of data ?? []) {
      m.set(g.id, overrides[g.id] ? { ...g, status: overrides[g.id]! } : g);
    }
    return Array.from(m.values());
  }, [data, overrides]);

  const byColumn = useMemo(() => {
    const m: Record<ColumnId, Goal[]> = { draft: [], active: [], paused: [], achieved: [] };
    for (const g of effective) {
      if (COLUMN_IDS.has(g.status as ColumnId)) {
        m[g.status as ColumnId].push(g);
      }
    }
    return m;
  }, [effective]);

  const onDragStart = (e: DragEvent<HTMLDivElement>, goalId: string): void => {
    setDragId(goalId);
    setMoveError(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", goalId);
  };

  const onDragEnd = (): void => {
    setDragId(null);
    setOverCol(null);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>, col: ColumnId): void => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverCol(col);
  };

  const onDrop = async (e: DragEvent<HTMLDivElement>, col: ColumnId): Promise<void> => {
    e.preventDefault();
    setOverCol(null);
    const goalId = e.dataTransfer.getData("text/plain") || dragId;
    setDragId(null);
    if (!goalId) return;
    const goal = effective.find((g) => g.id === goalId);
    if (!goal || goal.status === col) return;

    const prev = goal.status;
    setOverrides((o) => ({ ...o, [goalId]: col }));
    setBusy(goalId);
    try {
      await api.patchGoal(goalId, { status: col });
      // Pull fresh server truth, then drop the override.
      await refetch();
      setOverrides((o) => {
        const next = { ...o };
        delete next[goalId];
        return next;
      });
    } catch (err) {
      setOverrides((o) => ({ ...o, [goalId]: prev }));
      setMoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="meta">
          <div className="editorial-eyebrow">Board · Live</div>
          <div className="titlerow">
            <div className="h1">The board.</div>
          </div>
          <div className="small" style={{ maxWidth: 580, marginTop: 4 }}>
            Every goal in the studio. Drag a card between columns to change its
            status — every move writes a row to the audit log.
          </div>
        </div>
        <div className="stack-h">
          <button className="btn btn-sm" onClick={refetch}>
            <I name="spark" size={12} /> Refresh
          </button>
        </div>
      </div>

      {moveError && (
        <div
          style={{
            margin: "0 var(--pad-x) 12px",
            padding: 10,
            border: "1px solid var(--line)",
            borderLeft: "2px solid var(--neg)",
            borderRadius: "var(--radius)",
            background: "var(--bg-1)",
            fontSize: 12.5,
            color: "var(--ink-2)",
          }}
        >
          <span className="mono" style={{ color: "var(--neg)", marginRight: 8 }}>MOVE FAILED</span>
          {moveError}
        </div>
      )}

      {loading && <Loading label="Loading board…" />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!loading && !error && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${COLUMNS.length}, 1fr)`,
            borderTop: "1px solid var(--line)",
            height: "calc(100vh - var(--header-h) - 220px)",
            minHeight: 600,
          }}
        >
          {COLUMNS.map((c, i) => {
            const items = byColumn[c.id];
            const isOver = overCol === c.id;
            return (
              <div
                key={c.id}
                onDragOver={(e) => onDragOver(e, c.id)}
                onDragLeave={() => setOverCol((cur) => (cur === c.id ? null : cur))}
                onDrop={(e) => void onDrop(e, c.id)}
                style={{
                  borderRight: i < COLUMNS.length - 1 ? "1px solid var(--line)" : 0,
                  display: "flex",
                  flexDirection: "column",
                  background: isOver
                    ? "color-mix(in srgb, var(--ink) 5%, var(--bg))"
                    : c.id === "paused"
                      ? "color-mix(in srgb, var(--warn) 4%, var(--bg))"
                      : "var(--bg)",
                  transition: "background 0.1s",
                }}
              >
                <div
                  className="sticky-head"
                  style={{
                    padding: "16px var(--pad-x)",
                    borderBottom: "1px solid var(--line)",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{ width: 6, height: 18, background: c.accent, borderRadius: 1 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</div>
                    <div className="tiny mono" style={{ color: "var(--muted)" }}>{c.sub}</div>
                  </div>
                  <span className="num" style={{ fontSize: 13 }}>{items.length}</span>
                </div>
                <div style={{ padding: "12px var(--pad-x)", overflow: "auto", flex: 1 }}>
                  {items.map((g) => (
                    <Card
                      key={g.id}
                      goal={g}
                      busy={busy === g.id}
                      dragging={dragId === g.id}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onOpen={onOpenGoal}
                    />
                  ))}
                  {items.length === 0 && <div className="empty-hint">All clear.</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const Card = ({
  goal,
  busy,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  goal: Goal;
  busy: boolean;
  dragging: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>, id: string) => void;
  onDragEnd: () => void;
  onOpen: (id: string) => void;
}) => {
  const pct = progressPercent(goal);
  return (
    <div
      className="tcard"
      draggable={!busy}
      onDragStart={(e) => onDragStart(e, goal.id)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(goal.id)}
      style={{
        opacity: dragging ? 0.4 : busy ? 0.7 : 1,
        cursor: busy ? "wait" : "grab",
      }}
    >
      <div className="tk">
        <span>{goal.id.slice(0, 8)}</span>
        <span style={{ color: "var(--muted-2)" }}>·</span>
        <span style={{ color: "var(--ink-2)" }}>{goal.kind}</span>
        {busy && <span className="tiny mono" style={{ marginLeft: "auto", color: "var(--muted)" }}>saving…</span>}
      </div>
      <div className="tt">{goal.title}</div>

      {pct > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <div className="progressbar" style={{ flex: 1 }}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="num tiny" style={{ color: "var(--muted)" }}>{pct}%</span>
        </div>
      )}

      <div className="tm">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="tiny mono" style={{ color: "var(--muted)" }}>
            {goal.kind}
          </span>
        </div>
        <div className="tiny mono" style={{ color: "var(--muted)" }}>
          {dueLabel(goal.due_at)}
        </div>
      </div>
    </div>
  );
};
