import { useEffect, useMemo, useRef, useState } from "react";

import type { AgentSummary, AuditEntry, Goal } from "@blankcollar/shared";

import { I, type IconName } from "../icons";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import type { PageId } from "../App";

export type CmdNavigate = (page: PageId, goalId?: string) => void;

type CmdItemBase = {
  id: string;
  group: string;
  label: string;
  hint: string;
  icon: IconName;
  matchKeys: string;
  run: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  navigate: CmdNavigate;
};

const NAV_ITEMS: { id: PageId; label: string; icon: IconName; hint: string }[] = [
  { id: "dashboard", label: "Go to Dashboard",     icon: "home",     hint: "D" },
  { id: "goals",     label: "Go to Goals",         icon: "target",   hint: "G" },
  { id: "kanban",    label: "Go to Board",         icon: "kanban",   hint: "B" },
  { id: "brain",     label: "Go to Company Brain", icon: "brain",    hint: "?" },
  { id: "team",      label: "Go to Team",          icon: "users",    hint: "T" },
  { id: "skills",    label: "Go to Skills",        icon: "skills",   hint: "S" },
  { id: "tools",     label: "Go to Tools & MCPs",  icon: "plug",     hint: "M" },
  { id: "activity",  label: "Go to Activity",      icon: "activity", hint: "A" },
  { id: "inbox",     label: "Go to Inbox",         icon: "inbox",    hint: "I" },
  { id: "settings",  label: "Go to Settings",      icon: "settings", hint: "," },
];

export function CommandPalette({ open, onClose, navigate }: Props) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Lazy-load index when palette opens (cached for the session — refetch if
  // it's been more than 60s since last open).
  const lastFetchRef = useRef<number>(0);
  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    inputRef.current?.focus();
    const stale = Date.now() - lastFetchRef.current > 60_000;
    if (!stale && (goals.length > 0 || agents.length > 0)) return;
    lastFetchRef.current = Date.now();
    void Promise.allSettled([
      api.listGoals({ limit: 100 }),
      api.listAgents(),
      api.listAudit({ limit: 50 }),
    ]).then(([g, a, au]) => {
      if (g.status === "fulfilled") setGoals(g.value);
      if (a.status === "fulfilled") setAgents(a.value);
      if (au.status === "fulfilled") setAudit(au.value);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const items: CmdItemBase[] = useMemo(() => {
    const navs = NAV_ITEMS.map<CmdItemBase>((n) => ({
      id: `nav:${n.id}`,
      group: "Navigate",
      label: n.label,
      hint: n.hint,
      icon: n.icon,
      matchKeys: `${n.label} ${n.id} ${n.hint}`.toLowerCase(),
      run: () => navigate(n.id),
    }));
    const goalItems = goals.map<CmdItemBase>((g) => ({
      id: `goal:${g.id}`,
      group: "Goals",
      label: g.title,
      hint: `${g.id.slice(0, 8)} · ${g.status}`,
      icon: "target",
      matchKeys: `${g.title} ${g.id} ${g.status} ${g.kind}`.toLowerCase(),
      run: () => navigate("goal", g.id),
    }));
    const agentItems = agents.map<CmdItemBase>((a) => ({
      id: `agent:${a.id}`,
      group: "Agents",
      label: a.name,
      hint: a.kind,
      icon: "users",
      matchKeys: `${a.name} ${a.kind} ${a.id}`.toLowerCase(),
      run: () => navigate("team"),
    }));
    const auditItems = audit.slice(0, 30).map<CmdItemBase>((e) => ({
      id: `audit:${e.id}`,
      group: "Recent activity",
      label: `${e.action}${e.target_type ? ` · ${e.target_type}` : ""}`,
      hint: relativeTime(e.created_at),
      icon: "activity",
      matchKeys: `${e.action} ${e.target_type ?? ""} ${e.target_id ?? ""}`.toLowerCase(),
      run: () => navigate("activity"),
    }));
    return [...navs, ...goalItems, ...agentItems, ...auditItems];
  }, [goals, agents, audit, navigate]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items.slice(0, 30);
    return items.filter((it) => it.matchKeys.includes(needle)).slice(0, 80);
  }, [items, q]);

  // Reset selection when query changes; clamp on filtered shrink.
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    if (sel >= filtered.length) setSel(Math.max(0, filtered.length - 1));
  }, [filtered, sel]);

  // Keyboard handling
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(filtered.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[sel];
      if (item) {
        item.run();
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Auto-scroll selected into view.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLDivElement>(`[data-cmd-idx="${sel}"]`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [sel, open]);

  if (!open) return null;

  // Group rendering — preserve overall index for the mouse hover state.
  const groups = new Map<string, { item: CmdItemBase; idx: number }[]>();
  filtered.forEach((it, idx) => {
    const arr = groups.get(it.group) ?? [];
    arr.push({ item: it, idx });
    groups.set(it.group, arr);
  });

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          autoFocus
          className="cmd-input"
          placeholder="Type a command, search goals, jump to anything…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="cmd-list" ref={listRef}>
          {Array.from(groups.entries()).map(([group, entries]) => (
            <div key={group}>
              <div className="cmd-group">{group}</div>
              {entries.map(({ item, idx }) => (
                <div
                  key={item.id}
                  data-cmd-idx={idx}
                  className={`cmd-item ${idx === sel ? "sel" : ""}`}
                  onMouseEnter={() => setSel(idx)}
                  onClick={() => {
                    item.run();
                    onClose();
                  }}
                >
                  <I name={item.icon} className="ico" />
                  <span className="label">{item.label}</span>
                  <span className="hint">{item.hint}</span>
                </div>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                color: "var(--muted)",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
              }}
            >
              "{q}" — no results.
            </div>
          )}
        </div>
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> Navigate
          </span>
          <span>
            <span className="kbd">↵</span> Select
          </span>
          <span>
            <span className="kbd">esc</span> Close
          </span>
        </div>
      </div>
    </div>
  );
}
