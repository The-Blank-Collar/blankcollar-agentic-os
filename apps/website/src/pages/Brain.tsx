import { useMemo, useState } from "react";

import type { BrainGraph, BrainNode, BrainNodeKind } from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";
import { useFetch } from "../lib/useFetch";
import { Empty, ErrorState, Loading } from "../components/States";

type KindStyle = { fill: string; stroke: string; label: string };

const KIND_STYLE: Record<BrainNodeKind, KindStyle> = {
  person:  { fill: "var(--ink)",   stroke: "var(--ink)",   label: "Person" },
  agent:   { fill: "var(--bg)",    stroke: "var(--ink)",   label: "Agent" },
  goal:    { fill: "var(--bg-2)",  stroke: "var(--pos)",   label: "Goal" },
  capture: { fill: "var(--bg)",    stroke: "var(--info)",  label: "Capture" },
  tool:    { fill: "var(--bg-3)",  stroke: "var(--warn)",  label: "Tool / MCP" },
};

const KIND_RING: Record<BrainNodeKind, number> = {
  person:  18,
  agent:   32,
  goal:    48,
  capture: 64,
  tool:    78,
};

const NODE_RADIUS: Record<BrainNodeKind, number> = {
  person:  2.6,
  agent:   2.2,
  goal:    1.9,
  capture: 1.3,
  tool:    1.5,
};

type AllFilter = Record<BrainNodeKind, boolean>;

const DEFAULT_FILTER: AllFilter = {
  person: true,
  agent: true,
  goal: true,
  capture: true,
  tool: true,
};

/**
 * Stable polar layout: each kind gets a ring radius, each node within a kind
 * is angled by `i / count * 2π + offset(kind)`. Deterministic per-graph so
 * layout doesn't jump on refetch.
 */
function layout(graph: BrainGraph): Map<string, { x: number; y: number }> {
  const groups = new Map<BrainNodeKind, BrainNode[]>();
  for (const n of graph.nodes) {
    const arr = groups.get(n.kind) ?? [];
    arr.push(n);
    groups.set(n.kind, arr);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const kindOffset: Partial<Record<BrainNodeKind, number>> = {
    person: 0,
    agent: Math.PI / 7,
    goal: Math.PI / 11,
    capture: Math.PI / 5,
    tool: Math.PI / 3,
  };
  for (const [kind, items] of groups) {
    const r = KIND_RING[kind];
    const baseAngle = kindOffset[kind] ?? 0;
    items.forEach((n, i) => {
      const angle = baseAngle + (i / items.length) * Math.PI * 2;
      positions.set(n.id, {
        x: 50 + Math.cos(angle) * r,
        y: 50 + Math.sin(angle) * r,
      });
    });
  }
  return positions;
}

export function Brain() {
  const { data, error, loading, refetch } = useFetch<BrainGraph>(
    () => api.getBrainGraph({ limit: 80 }),
    [],
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<AllFilter>(DEFAULT_FILTER);
  const [search, setSearch] = useState("");

  const positions = useMemo(() => (data ? layout(data) : new Map()), [data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      person: 0, agent: 0, goal: 0, capture: 0, tool: 0,
    };
    for (const n of data?.nodes ?? []) c[n.kind] = (c[n.kind] ?? 0) + 1;
    return c;
  }, [data]);

  const matchesSearch = (n: BrainNode): boolean => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q);
  };

  const visibleNodes = useMemo(
    () => (data?.nodes ?? []).filter((n) => filter[n.kind] && matchesSearch(n)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, filter, search],
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const connected = useMemo(() => {
    const c = new Set<string>();
    if (!selected || !data) return c;
    for (const e of data.edges) {
      if (e.from === selected) c.add(e.to);
      if (e.to === selected) c.add(e.from);
    }
    return c;
  }, [data, selected]);

  const selectedNode = data?.nodes.find((n) => n.id === selected) ?? null;

  if (loading) {
    return (
      <div className="brain-wrap">
        <Loading label="Loading constellation…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="brain-wrap">
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }
  if (!data || data.nodes.length === 0) {
    return (
      <div className="brain-wrap">
        <Empty
          title="The brain is quiet."
          hint="Create a goal or hire an agent and the constellation populates itself."
        />
      </div>
    );
  }

  return (
    <div className="brain-wrap">
      {/* Background grid (Swiss) */}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.18 }}>
        <defs>
          <pattern id="bg-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="var(--line)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg-grid)" />
      </svg>

      {/* The graph */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {data.edges.map((e, i) => {
          const a = positions.get(e.from);
          const b = positions.get(e.to);
          if (!a || !b) return null;
          if (!visibleIds.has(e.from) || !visibleIds.has(e.to)) return null;
          const active = e.from === selected || e.to === selected;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={active ? "var(--ink)" : "var(--line-2)"}
              strokeWidth={active ? 0.18 : 0.1}
              opacity={active ? 0.85 : 0.45}
            />
          );
        })}
        {visibleNodes.map((n) => {
          const pos = positions.get(n.id);
          if (!pos) return null;
          const st = KIND_STYLE[n.kind];
          const isSel = n.id === selected;
          const isHov = n.id === hovered;
          const isConn = connected.has(n.id);
          const r = NODE_RADIUS[n.kind] * (isSel ? 1.4 : 1);
          const dim = selected && !isSel && !isConn ? 0.32 : 1;
          return (
            <g
              key={n.id}
              style={{ cursor: "pointer", opacity: dim }}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setSelected((s) => (s === n.id ? null : n.id))}
            >
              {isSel && <circle cx={pos.x} cy={pos.y} r={r * 2.2} fill="var(--ink)" opacity="0.08" />}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={r}
                fill={st.fill}
                stroke={st.stroke}
                strokeWidth={n.kind === "goal" || n.kind === "tool" ? 0.35 : 0.15}
              />
              <text
                x={pos.x}
                y={pos.y + r + 1.6}
                fontSize="1.5"
                fill="var(--ink-2)"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                opacity={isHov || isSel || isConn ? 1 : 0.55}
              >
                {n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* TL: search + filters */}
      <div className="brain-overlay-tl">
        <div className="brain-search">
          <I name="search" size={13} />
          <input
            placeholder="Filter nodes by label or id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="kbd">/</span>
        </div>
        <div className="brain-panel" style={{ marginTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Filters</div>
          {(Object.entries(KIND_STYLE) as [BrainNodeKind, KindStyle][]).map(([k, st]) => (
            <label
              key={k}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 0",
                cursor: "pointer",
                fontSize: 12.5,
              }}
              onClick={() => setFilter((f) => ({ ...f, [k]: !f[k] }))}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  border: "1px solid var(--line-2)",
                  borderRadius: 2,
                  display: "grid",
                  placeItems: "center",
                  background: filter[k] ? "var(--ink)" : "transparent",
                }}
              >
                {filter[k] && <I name="check" size={10} stroke={2.5} style={{ color: "var(--bg)" }} />}
              </span>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: st.fill,
                  border: `1px solid ${st.stroke}`,
                  boxSizing: "border-box",
                }}
              />
              <span style={{ flex: 1 }}>{st.label}</span>
              <span className="tiny mono">{counts[k] ?? 0}</span>
            </label>
          ))}
        </div>
      </div>

      {/* TR: stats */}
      <div className="brain-overlay-tr">
        <div className="brain-panel" style={{ minWidth: 240 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Brain · synthesized</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Stat label="nodes" value={String(data.nodes.length)} />
            <Stat label="edges" value={String(data.edges.length)} />
            <Stat label="visible" value={String(visibleNodes.length)} />
            <Stat
              label="last sync"
              value={new Date(data.generated_at).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            />
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="btn btn-sm" style={{ flex: 1 }} onClick={refetch}>
              <I name="spark" size={12} /> Refresh
            </button>
          </div>
          {data.truncated && (
            <div className="tiny" style={{ marginTop: 8, color: "var(--warn)" }}>
              Truncated · only the most recent 80 entities surfaced.
            </div>
          )}
        </div>
      </div>

      {/* BR: selected detail */}
      {selectedNode && (
        <div className="brain-overlay-br">
          <div className="brain-panel">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              {KIND_STYLE[selectedNode.kind].label}
            </div>
            <div className="h3" style={{ marginBottom: 4 }}>{selectedNode.label}</div>
            <div className="tiny mono" style={{ marginBottom: 12 }}>
              {selectedNode.id.slice(0, 12)}
            </div>
            <div className="tiny" style={{ marginBottom: 12 }}>
              {connected.size} connection{connected.size === 1 ? "" : "s"}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {Array.from(connected).slice(0, 6).map((id) => {
                const n = data.nodes.find((x) => x.id === id);
                if (!n) return null;
                return (
                  <span
                    key={id}
                    className="pill solid"
                    onClick={() => setSelected(id)}
                    style={{ cursor: "pointer" }}
                  >
                    {n.label.length > 18 ? n.label.slice(0, 17) + "…" : n.label}
                  </span>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => setSelected(null)}>
                Clear selection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="num" style={{ fontSize: 22, letterSpacing: "-0.02em" }}>{value}</div>
    <div className="tiny">{label}</div>
  </div>
);
