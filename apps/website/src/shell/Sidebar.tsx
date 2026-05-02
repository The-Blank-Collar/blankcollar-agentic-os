import { I, ChannelMark, type IconName } from "../icons";
import { you } from "../data/fixtures";
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
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" />
        <div className="brand-name">
          blankcollar<span>.ai</span>
        </div>
      </div>

      <div className="org-switcher" title="Switch organization">
        <div className="org-mark">TB</div>
        <div className="org-info">
          <div className="name">The Blank Collar</div>
          <div className="meta">studio · {role}</div>
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
          <div className="avatar h">{you.initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{you.name}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{role}</div>
          </div>
          <I name="settings" size={14} style={{ color: "var(--muted)" }} />
        </div>
      </div>
    </aside>
  );
}
