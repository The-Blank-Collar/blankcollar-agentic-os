import { useEffect } from "react";

import { Sidebar } from "../shell/Sidebar";
import { Topbar } from "../shell/Topbar";
import { Dashboard } from "./Dashboard";
import { Goals } from "./Goals";
import { GoalDetail } from "./GoalDetail";
import { Brain } from "./Brain";
import { Team } from "./Team";
import { Activity } from "./Activity";
import { Inbox } from "./Inbox";
import { Kanban } from "./Kanban";
import { Settings } from "./Settings";
import "../styles/print.css";

const noop = (): void => undefined;

const SCREENS: { label: string; page: string; el: () => JSX.Element }[] = [
  { label: "01 — Dashboard / Company Overview", page: "Studio · Dashboard",   el: () => <Dashboard onOpenGoal={noop} onOpenBrain={noop} /> },
  { label: "02 — Board (Kanban)",               page: "Studio · Board",       el: () => <Kanban onOpenGoal={noop} /> },
  { label: "03 — Goals",                        page: "Goals",                el: () => <Goals onOpenGoal={noop} /> },
  { label: "04 — Goal Detail",                  page: "Goals · Detail",       el: () => <GoalDetail goalId={null} /> },
  { label: "05 — Company Brain",                page: "Company brain",        el: () => <Brain /> },
  { label: "06 — Team / Roster",                page: "Team",                 el: () => <Team /> },
  { label: "07 — Activity Feed",                page: "Activity",             el: () => <Activity /> },
  { label: "08 — Inbox · Wants you",            page: "Inbox",                el: () => <Inbox onOpenGoal={noop} /> },
  { label: "09 — Settings",                     page: "Settings",             el: () => <Settings /> },
];

export function Print({ autoPrint = true }: { autoPrint?: boolean }) {
  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.density = "cozy";
    if (!autoPrint) return;
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        if ((document as Document & { fonts?: { ready: Promise<void> } }).fonts) {
          await (document as Document & { fonts?: { ready: Promise<void> } }).fonts!.ready;
        }
      } catch {
        // ignore — proceed to print anyway
      }
      if (cancelled) return;
      window.setTimeout(() => {
        try { window.print(); } catch { /* sandboxed previews disallow print */ }
      }, 1200);
    })();
    return () => { cancelled = true; };
  }, [autoPrint]);

  return (
    <div className="print-doc">
      {/* Cover */}
      <section className="print-page print-cover">
        <div className="print-cover-grid">
          <div className="brand-mark big" />
          <div className="editorial-eyebrow" style={{ marginTop: 24 }}>
            Blank Collar · Agentic OS
          </div>
          <h1 className="print-cover-title">
            The agentic<br />company OS.
          </h1>
          <div className="print-cover-sub">
            A high-fidelity walkthrough of the operator console.<br />
            Swiss editorial · dark · {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}.
          </div>
          <div className="print-toc">
            {SCREENS.map((s, i) => (
              <div key={i} className="print-toc-row">
                <span className="print-toc-n">P{String(i + 2).padStart(2, "0")}</span>
                <span className="print-toc-l">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {SCREENS.map((s, i) => (
        <section key={i} className="print-page">
          <div className="print-frame">
            <div className="print-chrome">
              <div className="brand-mark" />
              <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                The Blank Collar / OS
              </span>
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--ink)", marginLeft: "auto" }}
              >
                {s.label}
              </span>
            </div>
            <div className="print-screen">
              <div className="shell" style={{ height: "100%" }}>
                <Sidebar
                  page="dashboard"
                  setPage={noop}
                  role="Founder"
                />
                <div className="main">
                  <Topbar
                    crumbs={[s.page]}
                    onSearch={noop}
                    onNew={noop}
                  />
                  {s.el()}
                </div>
              </div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
