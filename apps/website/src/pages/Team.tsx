import { useMemo, useState } from "react";

import type { AgentSummary } from "@blankcollar/shared";

import { I, Sigil } from "../icons";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { Empty, ErrorState, Loading } from "../components/States";

type Filter = "all" | "active" | "inactive";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
];

/**
 * Stable seed for the deterministic Sigil. Mirrors the server-side
 * `sigilSeed()` helper in apps/paperclip/src/routes/agents.ts so the
 * mark stays the same whether rendered from list data or the per-agent
 * state endpoint.
 */
function sigilSeed(a: AgentSummary): string {
  const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug}-${a.kind}-${a.id.slice(0, 8)}`;
}

function statusDot(a: AgentSummary): string {
  return a.is_active ? "info" : "idle";
}

function activityHint(a: AgentSummary): string {
  const cfg = a.config as { activity?: string } | undefined;
  return cfg?.activity ?? (a.is_active ? "Active" : "Inactive");
}

export function Team() {
  const { data, error, loading, refetch } = useFetch<AgentSummary[]>(
    () => api.listAgents(),
    [],
  );
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: data?.length ?? 0, active: 0, inactive: 0 };
    for (const a of data ?? []) (a.is_active ? c.active++ : c.inactive++);
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data;
    return data.filter((a) => (filter === "active" ? a.is_active : !a.is_active));
  }, [data, filter]);

  const grouped = useMemo(() => {
    const m = new Map<string, AgentSummary[]>();
    for (const a of filtered) {
      const arr = m.get(a.kind) ?? [];
      arr.push(a);
      m.set(a.kind, arr);
    }
    return Array.from(m.entries()).sort((x, y) => x[0].localeCompare(y[0]));
  }, [filtered]);

  return (
    <div className="page">
      <div className="page-head">
        <div className="meta">
          <div className="editorial-eyebrow">Roster · live</div>
          <div className="titlerow">
            <div className="h1">Your team.</div>
          </div>
          <div className="small" style={{ maxWidth: 580, marginTop: 4 }}>
            Every agent the studio has hired. Each carries a deterministic
            sigil — the same mark wherever they show up in the system.
          </div>
        </div>
        <div className="stack-h">
          <button className="btn btn-sm" onClick={refetch}>
            <I name="spark" size={12} /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" disabled title="Hire flow arrives in S4">
            <I name="plus" size={12} /> Hire
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
            {f.label} <span className="v">{counts[f.key]}</span>
          </span>
        ))}
      </div>

      {loading && <Loading label="Loading agents…" />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!loading && !error && filtered.length === 0 && (
        <Empty
          title={filter === "all" ? "No agents yet." : `No ${filter} agents.`}
          hint="Bootstrap registers Hermes + OpenClaw on first boot."
        />
      )}
      {!loading && !error && grouped.length > 0 && grouped.map(([kind, agents]) => (
        <div key={kind} className="section">
          <div className="section-head">
            <div className="stack-h">
              <span className="title">{capitalize(kind)}</span>
              <span className="pill">{agents.length}</span>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {agents.map((a) => (
              <AgentCard key={a.id} agent={a} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const AgentCard = ({ agent }: { agent: AgentSummary }) => {
  const cfg = agent.config as { activity?: string; model?: string; version?: string | number } | undefined;
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div className="sigil" style={{ width: 40, height: 40 }}>
          <Sigil seed={sigilSeed(agent)} size={38} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{agent.name}</div>
          <div className="tiny mono">{agent.kind}</div>
        </div>
        <span className={`dot ${statusDot(agent)}`} />
      </div>
      <div className="small" style={{ marginTop: 12, color: "var(--ink-2)", minHeight: 36 }}>
        {activityHint(agent)}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        {cfg?.model && <span className="pill">{String(cfg.model)}</span>}
        {cfg?.version != null && <span className="pill">v{String(cfg.version)}</span>}
        <span className="pill">hired {relativeTime(agent.created_at)}</span>
      </div>
    </div>
  );
};

const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
