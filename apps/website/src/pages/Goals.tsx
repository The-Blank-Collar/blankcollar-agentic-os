import { useMemo, useState } from "react";

import type { Goal, GoalStatus } from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";
import { dueLabel, progressPercent, statusDot, statusLabel } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { Empty, ErrorState, Loading } from "../components/States";

type Filter = "all" | GoalStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "active",   label: "Active" },
  { key: "draft",    label: "Draft" },
  { key: "paused",   label: "Paused" },
  { key: "achieved", label: "Done" },
  { key: "archived", label: "Archived" },
];

type Props = {
  onOpenGoal: (id: string) => void;
  onNewGoal: () => void;
};

export function Goals({ onOpenGoal, onNewGoal }: Props) {
  const { data, error, loading, refetch } = useFetch<Goal[]>(
    () => api.listGoals({ limit: 100 }),
    [],
  );
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 };
    for (const g of data ?? []) c[g.status] = (c[g.status] ?? 0) + 1;
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return filter === "all" ? data : data.filter((g) => g.status === filter);
  }, [data, filter]);

  return (
    <div className="page">
      <div className="page-head">
        <div className="meta">
          <div className="editorial-eyebrow">Goals · live</div>
          <div className="titlerow">
            <div className="h1">Goals.</div>
          </div>
          <div className="small" style={{ maxWidth: 580, marginTop: 4 }}>
            Every goal across the studio. Click a row to open its heartbeat,
            key results, and contributors.
          </div>
        </div>
        <div className="stack-h">
          <button className="btn btn-sm" onClick={refetch}>
            <I name="spark" size={12} /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={onNewGoal}>
            <I name="plus" size={12} /> New goal
          </button>
        </div>
      </div>

      <div className="filterbar">
        {FILTERS.map((f) => (
          <span
            key={f.key}
            className={`filter-chip ${filter === f.key ? "active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label} <span className="v">{counts[f.key] ?? 0}</span>
          </span>
        ))}
      </div>

      {loading && <Loading label="Loading goals…" />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!loading && !error && filtered.length === 0 && (
        <Empty
          title={filter === "all" ? "No goals yet." : `No ${filter} goals.`}
          hint="The composer that creates them lands in Sprint 4."
        />
      )}
      {!loading && !error && filtered.length > 0 && (
        <div style={{ padding: "0 var(--pad-x)" }}>
          <div className="goal-list">
            {filtered.map((g) => (
              <GoalRow key={g.id} g={g} onOpen={onOpenGoal} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const GoalRow = ({ g, onOpen }: { g: Goal; onOpen: (id: string) => void }) => {
  const pct = progressPercent(g);
  return (
    <div className="goal-row" onClick={() => onOpen(g.id)}>
      <div className="gn">{g.id.slice(0, 8)}</div>
      <div>
        <div className="gtitle">{g.title}</div>
        <div className="gsub">
          {g.description?.split("\n")[0] ?? `${g.kind} · ${statusLabel(g.status)}`}
        </div>
      </div>
      <div className="gprog">
        <div className="progressbar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span style={{ width: 32, textAlign: "right" }}>{pct}%</span>
      </div>
      <div className="gowner">
        <span className="tiny mono" style={{ color: "var(--muted)" }}>
          {g.kind}
        </span>
      </div>
      <div className="gdue">
        <span className={`dot ${statusDot(g.status)}`} style={{ marginRight: 6 }} />
        {dueLabel(g.due_at)}
      </div>
      <div className="gmore">
        <I name="chev" size={14} />
      </div>
    </div>
  );
};
