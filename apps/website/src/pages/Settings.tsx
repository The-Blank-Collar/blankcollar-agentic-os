import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import type {
  AutonomyModeName,
  AutonomyModeRow,
  AutonomyResolved,
  Department,
  Organization,
  Whoami,
} from "@blankcollar/shared";

import { ChannelMark, I } from "../icons";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { ErrorState, Loading } from "../components/States";

type SectionId =
  | "overview"
  | "autonomy"
  | "people"
  | "governance"
  | "budgets"
  | "presets"
  | "policies"
  | "channels"
  | "billing";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "overview",   label: "Overview" },
  { id: "autonomy",   label: "Autonomy" },
  { id: "people",     label: "People & roles" },
  { id: "governance", label: "Governance" },
  { id: "budgets",    label: "Budgets" },
  { id: "presets",    label: "Industry preset" },
  { id: "policies",   label: "Agent policies" },
  { id: "channels",   label: "Channels" },
  { id: "billing",    label: "Billing" },
];

const DEFAULT_ORG_SLUG: string =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_DEFAULT_ORG_SLUG ?? "blankcollar-demo");

export function Settings() {
  const [section, setSection] = useState<SectionId>("overview");
  return (
    <div className="page">
      <div className="page-head">
        <div className="meta">
          <div className="editorial-eyebrow">Studio settings</div>
          <div className="titlerow">
            <div className="h1">How the studio runs.</div>
          </div>
          <div className="small" style={{ maxWidth: 620, marginTop: 4 }}>
            The rules of your company. What your team can decide alone, what needs your sign-off,
            how money flows, and who can see what.
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "220px 1fr",
          borderTop: "1px solid var(--line)",
          minHeight: "calc(100vh - var(--header-h) - 220px)",
        }}
      >
        <div
          style={{
            borderRight: "1px solid var(--line)",
            padding: "16px 8px",
            background: "var(--bg)",
          }}
        >
          {SECTIONS.map((s) => (
            <div
              key={s.id}
              className={`nav-item ${section === s.id ? "active" : ""}`}
              onClick={() => setSection(s.id)}
            >
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: "var(--pad-y) var(--pad-x)", overflow: "auto" }}>
          {section === "overview"   && <OverviewTab />}
          {section === "autonomy"   && <AutonomyTab />}
          {section === "people"     && <PeopleTab />}
          {section === "governance" && <GovernanceTab />}
          {section === "budgets"    && <BudgetsTab />}
          {section === "presets"    && <PresetsTab />}
          {section === "policies"   && <PoliciesTab />}
          {section === "channels"   && <ChannelsTab />}
          {section === "billing"    && <BillingTab />}
        </div>
      </div>
    </div>
  );
}

const ReadOnlyBanner = ({ what = "Editing" }: { what?: string }) => (
  <div
    style={{
      padding: "10px 14px",
      marginBottom: 18,
      border: "1px solid var(--line-2)",
      borderLeft: "2px solid var(--info)",
      borderRadius: "var(--radius)",
      background: "var(--bg-1)",
      fontSize: 12.5,
      color: "var(--ink-2)",
    }}
  >
    <span className="mono" style={{ color: "var(--info)", fontSize: 11, marginRight: 8 }}>
      READ-ONLY
    </span>
    {what} arrives in v2 — the data shows what the system already knows.
  </div>
);

const Section = ({ children }: { children: ReactNode }) => (
  <div style={{ maxWidth: 880 }}>{children}</div>
);

// -- Overview ----------------------------------------------------------------

function OverviewTab() {
  const orgQ = useFetch<Organization>(() => api.getOrgBySlug(DEFAULT_ORG_SLUG), []);
  const meQ = useFetch<Whoami>(() => api.whoami(), []);
  const deptsQ = useFetch<Department[]>(() => api.listDepartments(), []);

  const loading = orgQ.loading || meQ.loading || deptsQ.loading;
  const err = orgQ.error || meQ.error || deptsQ.error;

  return (
    <Section>
      <ReadOnlyBanner />
      {loading && <Loading label="Loading organisation…" />}
      {err && (
        <ErrorState
          error={err}
          onRetry={() => {
            orgQ.refetch();
            meQ.refetch();
            deptsQ.refetch();
          }}
        />
      )}
      {!loading && !err && orgQ.data && (
        <>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            {orgQ.data.name} · {orgQ.data.slug}
          </div>
          <div className="h3" style={{ marginBottom: 24 }}>Your operating model.</div>

          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <FactCell
                eyebrow="You"
                value={meQ.data?.role ?? "—"}
                hint={meQ.data?.department?.name ?? "no department scope"}
              />
              <FactCell
                eyebrow="Org age"
                value={relativeTime(orgQ.data.created_at)}
                hint={`created ${new Date(orgQ.data.created_at).toLocaleDateString()}`}
              />
              <FactCell
                eyebrow="Departments"
                value={String(deptsQ.data?.length ?? 0)}
                hint={
                  deptsQ.data && deptsQ.data.length > 0
                    ? deptsQ.data.map((d) => d.name).join(" · ")
                    : "none yet"
                }
              />
              <FactCell
                eyebrow="Active goals"
                value={String(
                  (deptsQ.data ?? []).reduce((acc, d) => acc + d.active_goal_count, 0),
                )}
                hint="across all departments"
              />
            </div>
          </div>

          <div className="eyebrow" style={{ margin: "24px 0 12px" }}>Departments</div>
          {(deptsQ.data ?? []).length === 0 ? (
            <div className="empty-hint">No departments configured.</div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {(deptsQ.data ?? []).map((d, i) => (
                <div
                  key={d.id}
                  style={{
                    padding: "14px 18px",
                    borderTop: i ? "1px solid var(--line)" : 0,
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 16,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{d.name}</div>
                    <div className="tiny mono" style={{ color: "var(--muted)" }}>{d.slug}</div>
                  </div>
                  <span className="pill">{d.active_goal_count} active</span>
                  <span className="tiny mono" style={{ color: "var(--muted)" }}>
                    {relativeTime(d.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

const FactCell = ({ eyebrow, value, hint }: { eyebrow: string; value: string; hint: string }) => (
  <div>
    <div className="eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>
    <div className="h4">{value}</div>
    <div className="small" style={{ color: "var(--ink-2)", marginTop: 4 }}>{hint}</div>
  </div>
);

// -- Autonomy ----------------------------------------------------------------

const MODE_OPTIONS: { mode: AutonomyModeName; label: string; hint: string; tone: string }[] = [
  {
    mode: "auto_approve",
    label: "Auto-approve",
    hint: "Run autonomously within safeguards. You're notified of results.",
    tone: "var(--pos)",
  },
  {
    mode: "ask_every_time",
    label: "Ask every time",
    hint: "Confirm every important action before it runs. The safe default.",
    tone: "var(--info)",
  },
  {
    mode: "planning",
    label: "Planning",
    hint: "Propose a plan first. You review and approve before anything executes.",
    tone: "var(--warn)",
  },
  {
    mode: "custom",
    label: "Custom",
    hint: "Delegate to your policy + safeguard rules. Use this once you've written specific rules.",
    tone: "var(--muted)",
  },
];

function AutonomyTab() {
  const listQ = useFetch<AutonomyModeRow[]>(() => api.listAutonomy(), []);
  const resolvedQ = useFetch<AutonomyResolved>(() => api.resolveAutonomy(), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<AutonomyModeName | null>(null);

  const orgRow = (listQ.data ?? []).find((r) => r.scope_kind === "org") ?? null;
  const currentMode = orgRow?.mode ?? "custom";

  // When the panel opens, sync the pending pick to whatever's saved.
  useEffect(() => {
    setPending(null);
  }, [orgRow?.id]);

  const choice = pending ?? currentMode;

  const save = async (): Promise<void> => {
    if (!pending || pending === currentMode || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.upsertAutonomy({ scope_kind: "org", mode: pending });
      await Promise.all([listQ.refetch(), resolvedQ.refetch()]);
      setPending(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dirty = pending !== null && pending !== currentMode;

  return (
    <Section>
      <div className="h3" style={{ marginBottom: 8 }}>Autonomy.</div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24, maxWidth: 620 }}>
        How much you want to be in the loop. The default applies across the
        whole studio; per-department, per-agent, and per-skill overrides
        arrive in a future sprint. Deny rules from <b>Governance</b> always win
        over the autonomy mode — autonomy can't bypass an explicit safeguard.
      </div>

      {listQ.loading && <Loading label="Loading autonomy state…" />}
      {listQ.error && <ErrorState error={listQ.error} onRetry={listQ.refetch} />}

      {!listQ.loading && !listQ.error && (
        <>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            Studio default
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 16 }}>
            {MODE_OPTIONS.map((opt) => {
              const selected = choice === opt.mode;
              const saved = currentMode === opt.mode;
              return (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => setPending(opt.mode)}
                  style={{
                    textAlign: "left",
                    padding: "14px 16px",
                    border: selected ? `2px solid ${opt.tone}` : "1px solid var(--line)",
                    background: selected ? "var(--bg-2)" : "var(--bg-1)",
                    color: "var(--ink)",
                    borderRadius: "var(--radius-lg)",
                    cursor: "pointer",
                    transition: "border-color 0.1s, background 0.1s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: opt.tone,
                      }}
                    />
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{opt.label}</span>
                    {saved && (
                      <span
                        className="mono"
                        style={{
                          marginLeft: "auto",
                          fontSize: 10,
                          letterSpacing: "0.1em",
                          color: "var(--muted)",
                          textTransform: "uppercase",
                        }}
                      >
                        Active
                      </span>
                    )}
                  </div>
                  <div className="small" style={{ color: "var(--ink-2)", lineHeight: 1.45 }}>
                    {opt.hint}
                  </div>
                </button>
              );
            })}
          </div>

          {err && (
            <div
              style={{
                padding: 10,
                marginBottom: 12,
                border: "1px solid var(--line)",
                borderLeft: "2px solid var(--neg)",
                borderRadius: "var(--radius)",
                background: "var(--bg-1)",
                fontSize: 12.5,
                color: "var(--ink-2)",
              }}
            >
              <span className="mono" style={{ color: "var(--neg)", marginRight: 8 }}>
                FAILED
              </span>
              {err}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={save}
              disabled={!dirty || busy}
            >
              {busy ? "Saving…" : dirty ? "Save change" : "Saved"}
            </button>
            {dirty && !busy && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPending(null)}
              >
                Discard
              </button>
            )}
            {orgRow && (
              <span className="tiny mono" style={{ color: "var(--muted)", marginLeft: "auto" }}>
                Last updated {relativeTime(orgRow.updated_at)}
              </span>
            )}
          </div>

          <div className="eyebrow" style={{ margin: "32px 0 10px" }}>
            What this looks like in practice
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div className="small" style={{ color: "var(--ink-2)", lineHeight: 1.6 }}>
              {resolvedQ.loading && "Computing…"}
              {!resolvedQ.loading && resolvedQ.data && (
                <ResolvedExplain resolved={resolvedQ.data} />
              )}
            </div>
          </div>

          <div className="eyebrow" style={{ margin: "32px 0 10px" }}>
            Per-scope overrides ({listQ.data?.length ?? 0})
          </div>
          {(listQ.data ?? []).length === 0 ? (
            <div className="empty-hint">
              Only the studio default is set. Per-department / agent / skill
              overrides arrive in a future sprint — until then, this default
              applies everywhere.
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {(listQ.data ?? []).map((r, i) => (
                <div
                  key={r.id}
                  style={{
                    padding: "12px 16px",
                    borderTop: i ? "1px solid var(--line)" : 0,
                    display: "grid",
                    gridTemplateColumns: "120px 1fr 1fr auto",
                    gap: 16,
                    alignItems: "center",
                    fontSize: 13,
                  }}
                >
                  <span className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>
                    {r.scope_kind}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
                    {r.scope_id ? r.scope_id.slice(0, 8) : "—"}
                  </span>
                  <span style={{ fontWeight: 500 }}>{r.mode}</span>
                  <span className="tiny mono" style={{ color: "var(--muted)" }}>
                    {relativeTime(r.updated_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

const ResolvedExplain = ({ resolved }: { resolved: AutonomyResolved }) => {
  const opt = MODE_OPTIONS.find((o) => o.mode === resolved.mode);
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        Right now, a fresh agent action <b>at the org level</b> resolves to{" "}
        <span
          className="mono"
          style={{
            padding: "2px 6px",
            background: "var(--bg-3)",
            borderRadius: 3,
            color: opt?.tone ?? "var(--ink)",
          }}
        >
          {resolved.mode}
        </span>{" "}
        — {opt?.hint ?? ""}
      </div>
      {resolved.source && (
        <div className="tiny" style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
          source: {resolved.source.scope_kind}
          {resolved.source.scope_id ? ` · ${resolved.source.scope_id.slice(0, 8)}` : ""}
        </div>
      )}
      {!resolved.source && (
        <div className="tiny" style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
          no row at any scope · falling back to <span style={{ fontWeight: 500 }}>custom</span>
          {" "}(policy engine decides)
        </div>
      )}
    </>
  );
};

// -- People & roles ----------------------------------------------------------

const ROLE_MATRIX: [string, string, string, string, string][] = [
  ["Set & change goals",        "✓",  "dept",   "—",      "—"],
  ["Approve $1K–$5K spend",     "✓",  "✓",      "—",      "—"],
  ["Approve >$5K spend",        "✓",  "—",      "—",      "—"],
  ["Send client communication", "✓",  "✓",      "review", "draft"],
  ["Hire / extend offer",       "✓",  "draft",  "—",      "draft"],
  ["Sign legal documents",      "✓",  "—",      "—",      "—"],
  ["Reassign agents",           "✓",  "dept",   "—",      "—"],
  ["Connect new tools",         "✓",  "review", "—",      "—"],
  ["View company brain",        "all","dept",   "assigned", "relevant"],
];

function PeopleTab() {
  return (
    <Section>
      <div className="h3" style={{ marginBottom: 8 }}>People & roles.</div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24, maxWidth: 620 }}>
        Three roles: <b>Founder</b> sees everything and decides. <b>Manager</b> runs a department.
        <b> Contributor</b> works on assigned tasks. Agents inherit the role of their manager.
      </div>
      <ReadOnlyBanner what="Role assignment" />
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 120px 120px 120px 120px",
            padding: "12px 16px",
            borderBottom: "1px solid var(--line)",
            background: "var(--bg-2)",
          }}
        >
          {["Capability", "Founder", "Manager", "Contributor", "Agent"].map((h) => (
            <div key={h} className="eyebrow">{h}</div>
          ))}
        </div>
        {ROLE_MATRIX.map((row, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 120px 120px 120px 120px",
              padding: "12px 16px",
              borderTop: i ? "1px solid var(--line)" : 0,
              fontSize: 13,
            }}
          >
            <div>{row[0]}</div>
            {row.slice(1).map((v, j) => (
              <div
                key={j}
                className="mono"
                style={{
                  fontSize: 11.5,
                  color: v === "✓" ? "var(--pos)" : v === "—" ? "var(--muted-2)" : "var(--ink-2)",
                }}
              >
                {v}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Section>
  );
}

// -- Governance --------------------------------------------------------------

const GOVERNANCE_RULES = [
  {
    title: "Spending",
    rules: [
      { l: "Auto-approve under", v: "$500", note: "vendor invoices, software, supplies" },
      { l: "Manager approves",   v: "$500–$5,000", note: "lead can sign on your behalf" },
      { l: "Founder approves",   v: "$5,000+", note: "always returns to you" },
    ],
  },
  {
    title: "Communication",
    rules: [
      { l: "Tone",                       v: "Studio voice", note: "warm, precise, founder-confident" },
      { l: "Outbound to new clients",    v: "Reviewed by you", note: "first 30 days, then auto" },
      { l: "Press & legal",              v: "Always reviewed", note: "drafted by agent, signed by you" },
    ],
  },
  {
    title: "Hiring",
    rules: [
      { l: "Within band",          v: "Manager + Recruiting", note: "you're notified" },
      { l: "Above band (≤20%)",    v: "Founder approves",     note: "with reasoning attached" },
      { l: "Above band (>20%)",    v: "Founder + advisor",    note: "Legal loops in advisor" },
    ],
  },
];

function GovernanceTab() {
  return (
    <Section>
      <div className="h3" style={{ marginBottom: 8 }}>Governance.</div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24, maxWidth: 620 }}>
        The lines your team won't cross without you. Set once. Audited every action.
      </div>
      <ReadOnlyBanner what="Editing rules" />
      {GOVERNANCE_RULES.map((g, i) => (
        <div key={i} className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>{g.title}</div>
          {g.rules.map((r, j) => (
            <div
              key={j}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                padding: "10px 0",
                borderTop: j ? "1px solid var(--line)" : 0,
                alignItems: "baseline",
              }}
            >
              <div>
                <div style={{ fontSize: 13 }}>{r.l}</div>
                <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 2 }}>{r.note}</div>
              </div>
              <div className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>{r.v}</div>
            </div>
          ))}
        </div>
      ))}
    </Section>
  );
}

// -- Budgets -----------------------------------------------------------------

function BudgetsTab() {
  return (
    <Section>
      <div className="h3" style={{ marginBottom: 24 }}>Budgets.</div>
      <ReadOnlyBanner what="Budget editing" />
      <div className="empty-hint">
        Budget rollups land in Phase 9 alongside the payment safety primitives.
      </div>
    </Section>
  );
}

// -- Presets ------------------------------------------------------------------

const PRESETS = [
  { n: "Design Studio",      sub: "Active preset",                     agents: 11, on: true },
  { n: "B2B SaaS Startup",   sub: "Eng-heavy · agent + human pairs",   agents: 14, on: false },
  { n: "Boutique Agency",    sub: "Client services + creative",         agents: 9,  on: false },
  { n: "E-commerce Brand",   sub: "Ops-heavy · CS + fulfillment",       agents: 13, on: false },
  { n: "Solo Operator",      sub: "Founder + 4 agents",                 agents: 4,  on: false },
  { n: "Custom",             sub: "Build from scratch",                 agents: 0,  on: false },
];

function PresetsTab() {
  return (
    <Section>
      <div className="h3" style={{ marginBottom: 8 }}>Industry preset.</div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24, maxWidth: 620 }}>
        A starting org chart, a starter team, and starter rules tuned for your industry.
      </div>
      <ReadOnlyBanner what="Preset switching" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {PRESETS.map((p) => (
          <div
            key={p.n}
            className="card"
            style={{
              padding: 18,
              borderColor: p.on ? "var(--ink)" : "var(--line)",
              borderWidth: p.on ? 2 : 1,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 12,
              }}
            >
              <I name="grid" size={18} />
              {p.on && (
                <span className="pill solid" style={{ color: "var(--pos)", borderColor: "var(--pos)" }}>
                  ● Active
                </span>
              )}
            </div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{p.n}</div>
            <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 4 }}>{p.sub}</div>
            <div className="small" style={{ marginTop: 12, color: "var(--ink-2)" }}>
              <span className="num">{p.agents}</span> agents
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// -- Policies ----------------------------------------------------------------

const POLICY_LINES = [
  "Treat every client like the studio's reputation depends on this exact email. It does.",
  "Never spend over $500 without a human approver. No exceptions, no \"just this once.\"",
  "If two agents disagree, say so plainly and route to the founder. Don't average opinions.",
  "When in doubt about scope, margin, or tone — ask the department lead before the founder.",
  "Numbers in client-facing copy always come from the live ledger. Never the cache.",
  "Refer suppliers by their working relationship with the studio, not their marketing copy.",
  "If something is going wrong, surface it within 30 minutes — even if you don't have a fix yet.",
];

function PoliciesTab() {
  return (
    <Section>
      <div className="h3" style={{ marginBottom: 8 }}>Agent policies.</div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24, maxWidth: 620 }}>
        Plain-English rules every agent reads before acting.
      </div>
      <ReadOnlyBanner what="Policy editing" />
      <div
        className="card"
        style={{
          padding: 24,
          fontFamily: "var(--font-serif)",
          fontSize: 16,
          lineHeight: 1.7,
          color: "var(--ink)",
        }}
      >
        <ol style={{ paddingLeft: 18, margin: 0 }}>
          {POLICY_LINES.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

// -- Channels ----------------------------------------------------------------

const CHANNELS_HARDCODED = [
  { ch: "slack",    n: "Slack workspace",   scope: "channels · read + write",  who: "Veda, Aster, Cobalt" },
  { ch: "email",    n: "Studio email",      scope: "Inbox triage + outbound",  who: "Veda, Quill" },
  { ch: "whatsapp", n: "WhatsApp Business", scope: "Client conversations",      who: "Veda" },
  { ch: "telegram", n: "Telegram",          scope: "Vendor lines",              who: "Sourcing agent" },
];

function ChannelsTab() {
  return (
    <Section>
      <div className="h3" style={{ marginBottom: 24 }}>Channels.</div>
      <ReadOnlyBanner what="Channel connection" />
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {CHANNELS_HARDCODED.map((c, i) => (
          <div
            key={i}
            style={{
              padding: "16px 20px",
              borderTop: i ? "1px solid var(--line)" : 0,
              display: "grid",
              gridTemplateColumns: "32px 1fr auto",
              gap: 16,
              alignItems: "center",
            }}
          >
            <ChannelMark ch={c.ch} size={28} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.n}</div>
              <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 2 }}>
                {c.scope} · {c.who}
              </div>
            </div>
            <button className="btn btn-sm" disabled>
              Manage
            </button>
          </div>
        ))}
      </div>
      <div className="tiny" style={{ marginTop: 12, color: "var(--muted)" }}>
        Real OAuth flows wire in via the Nango gateway in a future phase.
      </div>
    </Section>
  );
}

// -- Billing -----------------------------------------------------------------

function BillingTab() {
  return (
    <Section>
      <div className="h3" style={{ marginBottom: 24 }}>Billing.</div>
      <ReadOnlyBanner what="Plan management" />
      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Current plan</div>
        <div className="h2" style={{ marginBottom: 4 }}>
          Studio · $1,200<span style={{ fontSize: 18, color: "var(--muted)" }}>/mo</span>
        </div>
        <div className="small" style={{ color: "var(--ink-2)" }}>
          Up to 15 agents · unlimited humans · all MCPs
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-sm" disabled>Manage plan</button>
          <button className="btn btn-sm" disabled>Invoices</button>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          style={{ padding: "12px 20px", borderBottom: "1px solid var(--line)" }}
          className="eyebrow"
        >
          Usage · placeholder
        </div>
        {[
          { l: "Agent compute", v: "—", c: "wires in Phase 9" },
          { l: "Tool calls",    v: "—", c: "wires in Phase 9" },
          { l: "Brain storage", v: "—", c: "wires in Phase 9" },
        ].map((u, i) => (
          <div
            key={i}
            style={{
              padding: "14px 20px",
              borderTop: i ? "1px solid var(--line)" : 0,
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              gap: 16,
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 13 }}>{u.l}</div>
            <div className="num" style={{ fontSize: 13 }}>{u.v}</div>
            <div className="tiny mono" style={{ color: "var(--muted)" }}>{u.c}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

const _pageStyle: CSSProperties = { padding: "var(--pad-y) var(--pad-x)" };
void _pageStyle;
