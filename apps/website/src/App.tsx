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
import { Mobile } from "./pages/Mobile";
import { goals } from "./data/fixtures";
import { CommandPalette } from "./lib/cmdk";
import { GoalComposer } from "./components/GoalComposer";
import { InviteAccept } from "./components/InviteAccept";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { api } from "./lib/api";
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
  const [composerOpen, setComposerOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("invite");
    return t && /^[a-f0-9]{32,128}$/.test(t) ? t : null;
  });
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

  // First-run onboarding. If no profile exists yet (404), or one exists but
  // hasn't been completed, offer the wizard. Skipped if the user has
  // already dismissed it this session via localStorage.
  useEffect(() => {
    if (inviteToken) return; // Don't compete with the invite landing.
    const dismissed = window.localStorage.getItem("bc.onboarding.dismissed") === "true";
    if (dismissed) return;
    let cancelled = false;
    (async () => {
      try {
        const profile = await api.onboardingProfile();
        if (cancelled) return;
        if (!profile || !profile.completed_at) {
          setOnboardingOpen(true);
        }
      } catch {
        // Best-effort — don't block the app if the endpoint is down.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

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
      content = (
        <GoalDetail
          goalId={goalId}
          onAfterArchive={() => {
            setGoalId(null);
            setPage("goals");
          }}
        />
      );
      break;
    case "goals":
      content = <Goals onOpenGoal={openGoal} onNewGoal={() => setComposerOpen(true)} />;
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
      content = <Activity onOpenGoal={openGoal} />;
      break;
    case "inbox":
      content = <Inbox onOpenGoal={openGoal} />;
      break;
    case "settings":
      content = <Settings onOpenOnboarding={() => setOnboardingOpen(true)} />;
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
        <Mobile onCapture={() => setComposerOpen(true)} />
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
              onNew={() => setComposerOpen(true)}
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
      <GoalComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={(id) => openGoal(id)}
      />

      {inviteToken && (
        <InviteAccept
          token={inviteToken}
          onClose={() => {
            setInviteToken(null);
            // Strip the invite param so a refresh doesn't re-open the modal.
            const url = new URL(window.location.href);
            url.searchParams.delete("invite");
            window.history.replaceState({}, "", url.toString());
          }}
        />
      )}

      <OnboardingWizard
        open={onboardingOpen}
        onClose={() => {
          setOnboardingOpen(false);
          // Remember dismissal for this session so we don't badger the
          // operator on every page navigation. They can re-open from
          // Settings → Onboarding (Phase 7.b follow-up) or by clearing
          // localStorage.
          window.localStorage.setItem("bc.onboarding.dismissed", "true");
        }}
        onCompleted={() => {
          window.localStorage.setItem("bc.onboarding.dismissed", "true");
        }}
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
