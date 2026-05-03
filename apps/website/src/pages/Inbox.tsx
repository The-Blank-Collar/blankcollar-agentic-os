import { useMemo, useState } from "react";

import type { InboxItem, InboxItemKind, InboxSummary } from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { Empty, ErrorState, Loading } from "../components/States";

type Filter = "all" | InboxItemKind | "urgent";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all",            label: "All" },
  { key: "urgent",         label: "Urgent" },
  { key: "approval",       label: "Approvals" },
  { key: "decision",       label: "Decisions" },
  { key: "blocked",        label: "Blocked" },
  { key: "routine_output", label: "Routine output" },
  { key: "draft",          label: "Drafts" },
];

const KIND_BADGE: Record<InboxItemKind, { label: string; tone: string }> = {
  approval:       { label: "Approval",       tone: "var(--warn)" },
  decision:       { label: "Decision",       tone: "var(--info)" },
  blocked:        { label: "Blocked",        tone: "var(--neg)" },
  routine_output: { label: "Routine output", tone: "var(--ink-2)" },
  draft:          { label: "Draft",          tone: "var(--muted)" },
};

type Props = { onOpenGoal: (id: string) => void };

export function Inbox({ onOpenGoal }: Props) {
  const itemsQ = useFetch<InboxItem[]>(() => api.listInbox({ limit: 100 }), []);
  const summaryQ = useFetch<InboxSummary>(() => api.inboxSummary(), []);
  const [filter, setFilter] = useState<Filter>("all");
  const [busyGoal, setBusyGoal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts: Record<Filter, number> = useMemo(() => {
    const s = summaryQ.data;
    return {
      all: s?.total ?? itemsQ.data?.length ?? 0,
      urgent: s?.urgent ?? (itemsQ.data ?? []).filter((i) => i.urgency === "urgent").length,
      approval: s?.by_kind.approval ?? 0,
      decision: s?.by_kind.decision ?? 0,
      blocked: s?.by_kind.blocked ?? 0,
      routine_output: s?.by_kind.routine_output ?? 0,
      draft: s?.by_kind.draft ?? 0,
    };
  }, [summaryQ.data, itemsQ.data]);

  const filtered = useMemo(() => {
    const items = itemsQ.data ?? [];
    if (filter === "all") return items;
    if (filter === "urgent") return items.filter((i) => i.urgency === "urgent");
    return items.filter((i) => i.item_kind === filter);
  }, [itemsQ.data, filter]);

  const acknowledge = async (goalId: string): Promise<void> => {
    if (busyGoal) return;
    setBusyGoal(goalId);
    setError(null);
    try {
      await api.acknowledgeInbox(goalId);
      await Promise.all([itemsQ.refetch(), summaryQ.refetch()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyGoal(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="meta">
          <div className="editorial-eyebrow">
            Wants you · {counts.urgent > 0 ? `${counts.urgent} urgent` : `${counts.all} item${counts.all === 1 ? "" : "s"}`}
          </div>
          <div className="titlerow">
            <div className="h1">Inbox.</div>
          </div>
          <div className="small" style={{ maxWidth: 580, marginTop: 4 }}>
            Decisions only you can make, drafts awaiting your acknowledgement,
            and goals paused waiting for direction.
          </div>
        </div>
        <div className="stack-h">
          <button
            className="btn btn-sm"
            onClick={() => {
              itemsQ.refetch();
              summaryQ.refetch();
            }}
          >
            <I name="spark" size={12} /> Refresh
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

      {error && (
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
          <span className="mono" style={{ color: "var(--neg)", marginRight: 8 }}>FAILED</span>
          {error}
        </div>
      )}

      {itemsQ.loading && <Loading label="Loading inbox…" />}
      {itemsQ.error && <ErrorState error={itemsQ.error} onRetry={itemsQ.refetch} />}
      {!itemsQ.loading && !itemsQ.error && filtered.length === 0 && (
        <Empty
          title={filter === "all" ? "Nothing wants you." : `No ${filter} items.`}
          hint="The system handled it. Check Activity to see what just happened."
        />
      )}
      {!itemsQ.loading && !itemsQ.error && filtered.length > 0 && (
        <div style={{ padding: "var(--pad-y) var(--pad-x)" }}>
          {filtered.map((item, i) => (
            <Item
              key={`${item.item_kind}-${item.goal_id}-${i}`}
              item={item}
              busy={busyGoal === item.goal_id}
              onAcknowledge={() => void acknowledge(item.goal_id)}
              onOpenGoal={onOpenGoal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const Item = ({
  item,
  busy,
  onAcknowledge,
  onOpenGoal,
}: {
  item: InboxItem;
  busy: boolean;
  onAcknowledge: () => void;
  onOpenGoal: (id: string) => void;
}) => {
  const badge = KIND_BADGE[item.item_kind];
  const ackable = item.item_kind === "draft" || item.item_kind === "routine_output";
  const meta = item.metadata && Object.keys(item.metadata).length > 0
    ? item.metadata
    : null;
  return (
    <div className="card" style={{ padding: 20, marginBottom: 12 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 18,
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            width: 6,
            alignSelf: "stretch",
            background: badge.tone,
            borderRadius: 2,
            minHeight: 48,
          }}
        />
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 4 }}>
            <span
              className="mono"
              style={{
                fontSize: 10.5,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: badge.tone,
              }}
            >
              {badge.label}
            </span>
            <span className="tiny mono" style={{ color: "var(--muted)" }}>
              {relativeTime(item.created_at)}
            </span>
            {item.urgency === "urgent" && (
              <span className="pill solid" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>
                ● urgent
              </span>
            )}
          </div>
          <div className="h4" style={{ marginBottom: 8 }}>{item.title}</div>
          {meta && <MetaLine metadata={meta} itemKind={item.item_kind} />}
        </div>
        <div className="stack-v" style={{ alignItems: "flex-end", gap: 6 }}>
          {ackable && (
            <button
              className="btn btn-sm"
              onClick={onAcknowledge}
              disabled={busy}
              title="Mark all unacknowledged runs for this goal as seen"
            >
              {busy ? "Acknowledging…" : "Acknowledge"}
            </button>
          )}
          <button
            className="btn btn-sm btn-primary"
            onClick={() => onOpenGoal(item.goal_id)}
            disabled={item.item_kind === "approval"}
            title={item.item_kind === "approval" ? "Approval UI arrives in v2" : "Open goal"}
          >
            Open goal
          </button>
        </div>
      </div>
    </div>
  );
};

const MetaLine = ({
  metadata,
  itemKind,
}: {
  metadata: Record<string, unknown>;
  itemKind: InboxItemKind;
}) => {
  const due = metadata.due_at;
  const reason = metadata.reason;
  const actionKind = metadata.action_kind;
  const goalKind = metadata.goal_kind;
  const bits: string[] = [];
  if (typeof actionKind === "string") bits.push(actionKind);
  if (typeof goalKind === "string") bits.push(`goal=${goalKind}`);
  if (typeof reason === "string") bits.push(reason);
  if (typeof due === "string") bits.push(`due ${new Date(due).toLocaleDateString()}`);
  if (itemKind === "approval" && typeof metadata.approval_id === "string") {
    bits.push(`approval ${(metadata.approval_id as string).slice(0, 8)}`);
  }
  if (bits.length === 0) return null;
  return (
    <div className="small" style={{ color: "var(--ink-2)", maxWidth: 720, fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
      {bits.join(" · ")}
    </div>
  );
};
