import { useMemo, useState } from "react";

import type { AuditEntry, OrgMember } from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { Empty, ErrorState, Loading } from "../components/States";
import { RunDrilldown } from "../components/RunDrilldown";

const ACTION_GROUPS: { key: string; label: string; prefix?: string }[] = [
  { key: "all",      label: "All" },
  { key: "goal",     label: "Goals",     prefix: "goal." },
  { key: "run",      label: "Runs",      prefix: "run." },
  { key: "decision", label: "Decisions", prefix: "decision." },
  { key: "agent",    label: "Agents",    prefix: "agent." },
  { key: "tool",     label: "Tools",     prefix: "tool." },
];

const RANGE_OPTIONS: { key: string; label: string; hours: number | null }[] = [
  { key: "all",  label: "All time", hours: null },
  { key: "24h",  label: "24h",      hours: 24 },
  { key: "7d",   label: "7d",       hours: 24 * 7 },
  { key: "30d",  label: "30d",      hours: 24 * 30 },
];

type Props = {
  onOpenGoal?: (id: string) => void;
};

export function Activity({ onOpenGoal }: Props = {}) {
  const [filter, setFilter] = useState<string>("all");
  const [rangeKey, setRangeKey] = useState<string>("all");
  const [actorId, setActorId] = useState<string>("");
  const [drilldownRunId, setDrilldownRunId] = useState<string | null>(null);

  const sinceIso = useMemo(() => {
    const range = RANGE_OPTIONS.find((r) => r.key === rangeKey);
    if (!range?.hours) return undefined;
    return new Date(Date.now() - range.hours * 3_600_000).toISOString();
  }, [rangeKey]);

  const { data, error, loading, refetch } = useFetch<AuditEntry[]>(
    () =>
      api.listAudit({
        limit: 200,
        ...(sinceIso ? { since: sinceIso } : {}),
        ...(actorId ? { actor_id: actorId } : {}),
      }),
    [sinceIso, actorId],
  );

  const membersQ = useFetch<OrgMember[]>(() => api.listOrgMembers(), []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 };
    for (const e of data ?? []) {
      const prefix = e.action.split(".")[0];
      c[prefix] = (c[prefix] ?? 0) + 1;
    }
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data;
    const group = ACTION_GROUPS.find((g) => g.key === filter);
    if (!group?.prefix) return data;
    return data.filter((e) => e.action.startsWith(group.prefix!));
  }, [data, filter]);

  return (
    <div className="page">
      <div className="page-head">
        <div className="meta">
          <div className="editorial-eyebrow">Activity · live</div>
          <div className="titlerow">
            <div className="h1">What just happened.</div>
          </div>
          <div className="small" style={{ maxWidth: 580, marginTop: 4 }}>
            Every action your team takes — goals created, runs dispatched,
            decisions resolved, tools invoked. The audit log, rendered.
          </div>
        </div>
        <div className="stack-h">
          <span className="live-tag">
            <span className="dot" />
            Streaming
          </span>
          <button className="btn btn-sm" onClick={refetch}>
            <I name="spark" size={12} /> Refresh
          </button>
        </div>
      </div>

      <div className="filterbar">
        {ACTION_GROUPS.map((g) => (
          <span
            key={g.key}
            className={`filter-chip ${filter === g.key ? "active" : ""}`}
            onClick={() => setFilter(g.key)}
          >
            {g.label} <span className="v">{counts[g.key] ?? 0}</span>
          </span>
        ))}
      </div>

      <div
        className="filterbar"
        style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
      >
        <span className="tiny mono" style={{ color: "var(--muted)" }}>RANGE</span>
        {RANGE_OPTIONS.map((r) => (
          <span
            key={r.key}
            className={`filter-chip ${rangeKey === r.key ? "active" : ""}`}
            onClick={() => setRangeKey(r.key)}
          >
            {r.label}
          </span>
        ))}
        <span className="tiny mono" style={{ color: "var(--muted)", marginLeft: 8 }}>ACTOR</span>
        <select
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
          style={{
            height: 28,
            padding: "0 8px",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            background: "var(--bg)",
            color: "var(--ink)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          <option value="">Anyone</option>
          {(membersQ.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name ?? m.email} · {m.role ?? "no role"}
            </option>
          ))}
        </select>
      </div>

      {loading && <Loading label="Loading audit feed…" />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!loading && !error && filtered.length === 0 && (
        <Empty title="Quiet so far." hint="Mutations write here as soon as they happen." />
      )}
      {!loading && !error && filtered.length > 0 && (
        <div style={{ padding: "0 var(--pad-x)" }}>
          {filtered.map((e) => (
            <Row
              key={e.id}
              entry={e}
              onOpenRun={
                e.target_type === "run" && e.target_id
                  ? () => setDrilldownRunId(e.target_id!)
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {drilldownRunId && (
        <RunDrilldown
          runId={drilldownRunId}
          onClose={() => setDrilldownRunId(null)}
          onOpenGoal={onOpenGoal}
        />
      )}
    </div>
  );
}

const Row = ({
  entry,
  onOpenRun,
}: {
  entry: AuditEntry;
  onOpenRun?: () => void;
}) => {
  const meta = entry.metadata && Object.keys(entry.metadata).length > 0
    ? JSON.stringify(entry.metadata)
    : null;
  return (
    <div
      onClick={onOpenRun}
      style={{
        display: "grid",
        gridTemplateColumns: "140px 32px 1fr",
        gap: 16,
        padding: "16px 0",
        borderTop: "1px solid var(--line)",
        alignItems: "flex-start",
        cursor: onOpenRun ? "pointer" : undefined,
      }}
      title={onOpenRun ? "Open run drilldown" : undefined}
    >
      <div className="tiny mono" style={{ paddingTop: 6, color: "var(--muted)" }}>
        {relativeTime(entry.created_at)}
      </div>
      <div>
        <div
          className="sigil"
          style={{
            width: 28,
            height: 28,
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--ink-2)",
          }}
        >
          {actorBadge(entry)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 13.5 }}>
          <span className="mono" style={{ fontWeight: 500 }}>{entry.action}</span>
          {entry.target_type && (
            <>
              {" "}
              <span style={{ color: "var(--muted)" }}>on</span>{" "}
              <span className="mono">{entry.target_type}</span>
              {entry.target_id && (
                <>
                  {" "}
                  <span className="mono" style={{ color: "var(--muted)" }}>
                    {String(entry.target_id).slice(0, 8)}
                  </span>
                </>
              )}
            </>
          )}
          {entry.actor_role && (
            <span className="ch-tag">{entry.actor_role}</span>
          )}
        </div>
        {meta && (
          <div
            className="small"
            style={{
              marginTop: 6,
              color: "var(--ink-2)",
              maxWidth: 720,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              wordBreak: "break-word",
            }}
          >
            {meta.slice(0, 320)}
            {meta.length > 320 && <span style={{ color: "var(--muted)" }}>…</span>}
          </div>
        )}
      </div>
    </div>
  );
};

function actorBadge(e: AuditEntry): string {
  if (e.actor_role) return e.actor_role.charAt(0).toUpperCase();
  if (e.actor_id) return "·";
  return "sys";
}
