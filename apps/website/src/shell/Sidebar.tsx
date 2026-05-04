import type { Whoami } from "@blankcollar/shared";

import { I, ChannelMark, type IconName } from "../icons";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useFetch } from "../lib/useFetch";
import type { PageId } from "../App";

export type NavItem = { id: PageId; label: string; icon: IconName; count?: string };

export const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "home" },
  { id: "kanban", label: "Board", icon: "kanban" },
  { id: "goals", label: "Goals", icon: "target", count: "12" },
  { id: "brain", label: "Company Brain", icon: "brain" },
  { id: "team", label: "Team", icon: "users", count: "13" },
  { id: "skills", label: "Skills Library", icon: "skills" },
  { id: "tools", label: "Tools & MCPs", icon: "plug", count: "21" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "inbox", label: "Inbox", icon: "inbox", count: "3" },
];

const PROJECTS = [
  { id: "p-lark", label: "Project Lark" },
  { id: "p-hadid", label: "Hadid Residence" },
  { id: "p-sycamore", label: "Sycamore" },
  { id: "p-elm", label: "Elm (archived)" },
];

const CHANNELS = [
  { ch: "slack", label: "Slack", count: "12" },
  { ch: "whatsapp", label: "WhatsApp", count: "4" },
  { ch: "telegram", label: "Telegram", count: "1" },
  { ch: "email", label: "Email", count: "8" },
];

type Props = {
  page: PageId;
  setPage: (p: PageId) => void;
  role: string;
};

export function Sidebar({ page, setPage, role }: Props) {
  const auth = useAuth();
  const whoamiQ = useFetch<Whoami>(() => api.whoami(), []);
  const me = whoamiQ.data;
  const orgName = me?.org.name ?? "Your studio";
  const orgInitials = (orgName.match(/\b[A-Z]/g)?.join("") ?? orgName.slice(0, 2)).slice(0, 2).toUpperCase();
  const displayName = me?.user?.full_name
    ?? me?.user?.email
    ?? (me?.mode === "demo" ? "Demo operator" : "You");
  const displayInitials = (
    me?.user?.full_name
      ? me.user.full_name.split(/\s+/).map((p) => p[0] ?? "").join("")
      : me?.user?.email
        ? me.user.email.slice(0, 2)
        : "DO"
  ).slice(0, 2).toUpperCase();
  const subline = me?.mode === "demo"
    ? `demo · ${me.role ?? role}`
    : `${me?.role ?? role}`;
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" />
        <div className="brand-name">
          blankcollar<span>.ai</span>
        </div>
      </div>

      <div className="org-switcher" title="Switch organization">
        <div className="org-mark">{orgInitials}</div>
        <div className="org-info">
          <div className="name">{orgName}</div>
          <div className="meta">{subline}</div>
        </div>
        <I name="chevd" size={14} style={{ color: "var(--muted)" }} />
      </div>

      <div className="nav-section">
        <div className="nav-label">Workspace</div>
        {NAV.map((n) => (
          <div
            key={n.id}
            className={`nav-item ${page === n.id ? "active" : ""}`}
            onClick={() => setPage(n.id)}
          >
            <I name={n.icon} className="ico" />
            <span>{n.label}</span>
            {n.count && <span className="count">{n.count}</span>}
          </div>
        ))}
      </div>

      <div className="nav-section">
        <div className="nav-label">
          Projects
          <I name="plus" size={11} style={{ color: "var(--muted)", cursor: "pointer" }} />
        </div>
        {PROJECTS.map((p) => (
          <div key={p.id} className="nav-item">
            <span style={{ width: 10, height: 10, border: "1px solid var(--ink-2)", borderRadius: 2, flexShrink: 0 }} />
            <span>{p.label}</span>
          </div>
        ))}
      </div>

      <div className="nav-section">
        <div className="nav-label">Channels</div>
        {CHANNELS.map((c) => (
          <div key={c.ch} className="nav-item">
            <ChannelMark ch={c.ch} size={14} />
            <span>{c.label}</span>
            <span className="count">{c.count}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="you" onClick={() => setPage("settings")}>
          <div className="avatar h">{displayInitials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{displayName}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
              {me?.mode === "demo" ? "demo mode" : me?.user?.email ?? me?.role ?? role}
            </div>
          </div>
          <I name="settings" size={14} style={{ color: "var(--muted)" }} />
        </div>
        {auth.mode === "auth" && auth.session && (
          <button
            type="button"
            onClick={() => void auth.signOut()}
            title="Sign out"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 12px",
              marginTop: 4,
              background: "transparent",
              border: 0,
              borderTop: "1px solid var(--line)",
              color: "var(--muted)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            Sign out
          </button>
        )}
      </div>
    </aside>
  );
}
