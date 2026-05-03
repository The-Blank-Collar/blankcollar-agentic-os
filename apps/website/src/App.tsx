import { useEffect, useState } from "react";
import { Sidebar } from "./shell/Sidebar";
import { Topbar } from "./shell/Topbar";
import { Dashboard } from "./pages/Dashboard";
import { Goals } from "./pages/Goals";
import { GoalDetail } from "./pages/GoalDetail";
import { Brain } from "./pages/Brain";
import { Team } from "./pages/Team";
import { Skills } from "./pages/Skills";
import { Tools } from "./pages/Tools";
import { Activity } from "./pages/Activity";
import { Inbox } from "./pages/Inbox";
import { Kanban } from "./pages/Kanban";
import { Settings } from "./pages/Settings";
import { Print } from "./pages/Print";
import { MobilePlaceholder } from "./pages/MobilePlaceholder";
import { goals } from "./data/fixtures";
import { CommandPalette } from "./lib/cmdk";
import {
  DEFAULT_TWEAKS,
  TweakRadio,
  TweakSection,
  TweakToggle,
  TweaksPanel,
  useTweaks,
} from "./lib/tweaks";

export type PageId =
  | "dashboard"
  | "goals"
  | "goal"
  | "brain"
  | "team"
  | "skills"
  | "tools"
  | "activity"
  | "inbox"
  | "kanban"
  | "settings";

const CRUMBS: Record<Exclude<PageId, "goal">, string[]> = {
  dashboard: ["Studio", "Dashboard"],
  goals: ["Goals"],
  brain: ["Company brain"],
  team: ["Team"],
  skills: ["Skills"],
  tools: ["Tools & MCPs"],
  activity: ["Activity"],
  inbox: ["Inbox"],
  kanban: ["Studio", "Board"],
  settings: ["Settings"],
};

export default function App() {
  const [tweaks, setTweak] = useTweaks(DEFAULT_TWEAKS);
  const [page, setPage] = useState<PageId>("dashboard");
  const [goalId, setGoalId] = useState<string | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [printMode, setPrintMode] = useState<boolean>(
    typeof window !== "undefined" && window.location.hash.replace(/^#\/?/, "") === "print",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = tweaks.theme;
    document.documentElement.dataset.density = tweaks.density;
  }, [tweaks.theme, tweaks.density]);

  // ⌘K / Ctrl+K opens the palette; Esc closes it (also handled inside).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // URL hash routing for /print so it can be deep-linked + printed cleanly.
  useEffect(() => {
    const onHash = (): void => {
      const h = window.location.hash.replace(/^#\/?/, "");
      setPrintMode(h === "print");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openGoal = (id: string): void => {
    setGoalId(id);
    setPage("goal");
  };

  const navigateFromPalette = (target: PageId, id?: string): void => {
    if (target === "goal" && id) {
      openGoal(id);
    } else {
      setPage(target);
      setGoalId(null);
    }
  };

  if (printMode) {
    return <Print />;
  }

  const crumbs = (() => {
    if (page === "goal") {
      const g = goals.find((x) => x.id === goalId);
      return ["Goals", g ? g.id : "Goal"];
    }
    return CRUMBS[page] ?? ["Studio"];
  })();

  let content: JSX.Element;
  switch (page) {
    case "goal":
      content = <GoalDetail goalId={goalId} />;
      break;
    case "goals":
      content = <Goals onOpenGoal={openGoal} />;
      break;
    case "kanban":
      content = <Kanban onOpenGoal={openGoal} />;
      break;
    case "brain":
      content = <Brain />;
      break;
    case "team":
      content = <Team />;
      break;
    case "skills":
      content = <Skills />;
      break;
    case "tools":
      content = <Tools />;
      break;
    case "activity":
      content = <Activity />;
      break;
    case "inbox":
      content = <Inbox onOpenGoal={openGoal} />;
      break;
    case "settings":
      content = <Settings />;
      break;
    default:
      content = (
        <Dashboard
          onOpenGoal={openGoal}
          onOpenBrain={() => setPage("brain")}
        />
      );
  }

  const surface = tweaks.surface;

  return (
    <>
      <div className="surface-toggle">
        <button
          className={surface === "desktop" ? "on" : ""}
          onClick={() => setTweak("surface", "desktop")}
        >
          Desktop
        </button>
        <button
          className={surface === "mobile" ? "on" : ""}
          onClick={() => setTweak("surface", "mobile")}
        >
          Mobile
        </button>
      </div>

      {surface === "mobile" ? (
        <div className="mobile-stage">
          <MobilePlaceholder />
        </div>
      ) : (
        <div className="shell">
          <Sidebar
            page={page}
            setPage={(p) => {
              setPage(p);
              setGoalId(null);
            }}
            role={tweaks.role}
          />
          <div className="main">
            <Topbar
              crumbs={crumbs}
              onSearch={() => setCmdOpen(true)}
              onNew={() => setCmdOpen(true)}
            />
            {content}
          </div>
        </div>
      )}

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        navigate={navigateFromPalette}
      />

      <TweaksPanel title="Tweaks">
        <TweakSection title="Surface">
          <TweakRadio
            label="Form factor"
            value={surface}
            options={[
              { value: "desktop", label: "Desktop" },
              { value: "mobile", label: "Mobile" },
            ]}
            onChange={(v) => setTweak("surface", v)}
          />
        </TweakSection>
        <TweakSection title="Appearance">
          <TweakRadio
            label="Theme"
            value={tweaks.theme}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onChange={(v) => setTweak("theme", v)}
          />
          <TweakRadio
            label="Density"
            value={tweaks.density}
            options={[
              { value: "cozy", label: "Cozy" },
              { value: "compact", label: "Compact" },
            ]}
            onChange={(v) => setTweak("density", v)}
          />
        </TweakSection>
        <TweakSection title="Role view">
          <TweakRadio
            label="Viewing as"
            value={tweaks.role}
            options={[
              { value: "Founder", label: "Founder" },
              { value: "Manager", label: "Manager" },
              { value: "Contributor", label: "Contrib" },
            ]}
            onChange={(v) => setTweak("role", v)}
          />
        </TweakSection>
        <TweakSection title="Demo">
          <TweakToggle
            label="Show live agent feed"
            value={tweaks.showLiveFeed}
            onChange={(v) => setTweak("showLiveFeed", v)}
          />
          <TweakToggle
            label="Populated state"
            value={tweaks.populated}
            onChange={(v) => setTweak("populated", v)}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}
