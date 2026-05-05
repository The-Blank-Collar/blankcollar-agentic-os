import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import type {
  AutonomyModeName,
  AutonomyModeRow,
  AutonomyResolved,
  ConnectorProviderInfo,
  ConnectorProviderKey,
  ConnectorRow,
  ConnectorSyncResult,
  Department,
  InvitableRole,
  InvitationRow,
  MemoryExploreResponse,
  OnboardingDerived,
  OnboardingProfile,
  OrgMember,
  Organization,
  PricingPlan,
  SubscriptionRow,
  OutcomeMetricRow,
  OutcomeRow,
  PolicyEffect,
  SafeguardParsedRule,
  SafeguardParseWarning,
  SafeguardPreview as SafeguardPreviewT,
  SafeguardRow,
  Whoami,
} from "@blankcollar/shared";

import { ChannelMark, I } from "../icons";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { Empty, ErrorState, InlineError, Loading } from "../components/States";

type SectionId =
  | "overview"
  | "onboarding"
  | "memory"
  | "autonomy"
  | "safeguards"
  | "connectors"
  | "performance"
  | "people"
  | "governance"
  | "budgets"
  | "presets"
  | "policies"
  | "channels"
  | "billing";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "overview",    label: "Overview" },
  { id: "onboarding",  label: "Onboarding" },
  { id: "memory",      label: "Memory" },
  { id: "autonomy",    label: "Autonomy" },
  { id: "safeguards",  label: "Safeguards" },
  { id: "connectors",  label: "Connectors" },
  { id: "performance", label: "Performance" },
  { id: "people",      label: "People & roles" },
  { id: "governance",  label: "Governance" },
  { id: "budgets",     label: "Budgets" },
  { id: "presets",     label: "Industry preset" },
  { id: "policies",    label: "Agent policies" },
  { id: "channels",    label: "Channels" },
  { id: "billing",     label: "Billing" },
];

const DEFAULT_ORG_SLUG: string =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_DEFAULT_ORG_SLUG ?? "blankcollar-demo");

type Props = {
  onOpenOnboarding?: () => void;
};

export function Settings({ onOpenOnboarding }: Props = {}) {
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
          {section === "overview"    && <OverviewTab />}
          {section === "onboarding"  && <OnboardingTab onReopen={onOpenOnboarding} />}
          {section === "memory"      && <MemoryTab />}
          {section === "autonomy"    && <AutonomyTab />}
          {section === "safeguards"  && <SafeguardsTab />}
          {section === "connectors"  && <ConnectorsTab />}
          {section === "performance" && <PerformanceTab />}
          {section === "people"      && <PeopleTab />}
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

// -- Safeguards --------------------------------------------------------------

const SAFEGUARD_TEMPLATE = `# Safeguards

Plain-English rules. Each bullet becomes a policy that the system enforces
on every action. Lines starting with "Never X without approval" require
approval before X runs. Lines starting with "Never X" block X outright.

## Communication
- Never send outbound email without approval. (skill: email.send)
- Always review press releases. (skill: press.send)

## Spending
- Never spend more than $200 in one transaction.
- Auto-approve invoices under $50. (effect: allow)

## Hiring
- Never extend an offer without approval. (skill: hire.extend_offer)
`;

const EFFECT_TONE: Record<PolicyEffect, string> = {
  allow:   "var(--pos)",
  approve: "var(--info)",
  deny:    "var(--neg)",
};

function SafeguardsTab() {
  const listQ = useFetch<SafeguardRow[]>(() => api.listSafeguards(), []);
  const orgRow = (listQ.data ?? []).find((r) => r.scope_kind === "org") ?? null;

  const [draft, setDraft] = useState<string>("");
  const [preview, setPreview] = useState<SafeguardPreviewT | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // When the saved row arrives or changes, sync the editor draft.
  useEffect(() => {
    if (orgRow) {
      setDraft(orgRow.content_md);
      setPreview(null);
      setErr(null);
    } else if (!listQ.loading && draft === "") {
      setDraft(SAFEGUARD_TEMPLATE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgRow?.id, orgRow?.updated_at, listQ.loading]);

  const dirty = orgRow ? draft !== orgRow.content_md : draft !== SAFEGUARD_TEMPLATE && draft.trim().length > 0;

  const onPreview = async (): Promise<void> => {
    if (previewing) return;
    setPreviewing(true);
    setErr(null);
    try {
      const r = await api.previewSafeguards(draft);
      setPreview(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const onSave = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const saved = await api.upsertSafeguard({
        scope_kind: "org",
        content_md: draft,
      });
      // Update preview so the user can confirm what was saved.
      setPreview({
        rule_count: saved.rule_count,
        rules: saved.rules,
        warnings: saved.warnings,
        content_hash: saved.content_hash,
      });
      setSavedAt(saved.updated_at);
      await listQ.refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section>
      <div className="h3" style={{ marginBottom: 8 }}>Safeguards.</div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24, maxWidth: 620 }}>
        The lines your team won't cross — written in plain English. Each
        bullet becomes a rule the existing policy engine enforces on every
        action. <b>Deny rules here always win</b> over the autonomy mode you
        picked above. Per-department and per-agent safeguards arrive in a
        future sprint; for now this is the studio-wide default.
      </div>

      {listQ.loading && <Loading label="Loading safeguards…" />}
      {listQ.error && <ErrorState error={listQ.error} onRetry={listQ.refetch} />}

      {!listQ.loading && !listQ.error && (
        <>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Studio safeguards</div>

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 320,
              padding: 14,
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-lg)",
              background: "var(--bg-1)",
              color: "var(--ink)",
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              lineHeight: 1.6,
              outline: "none",
              resize: "vertical",
            }}
          />

          {err && (
            <div
              style={{
                padding: 10,
                marginTop: 12,
                border: "1px solid var(--line)",
                borderLeft: "2px solid var(--neg)",
                borderRadius: "var(--radius)",
                background: "var(--bg-1)",
                fontSize: 12.5,
                color: "var(--ink-2)",
              }}
            >
              <span className="mono" style={{ color: "var(--neg)", marginRight: 8 }}>FAILED</span>
              {err}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={onPreview}
              disabled={previewing}
            >
              {previewing ? "Parsing…" : "Preview rules"}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onSave}
              disabled={busy || !dirty}
            >
              {busy ? "Saving…" : dirty ? "Save safeguards" : "Saved"}
            </button>
            {orgRow && (
              <span className="tiny mono" style={{ color: "var(--muted)", marginLeft: "auto" }}>
                {savedAt ? `Just saved · ${relativeTime(savedAt)}` : `Last saved ${relativeTime(orgRow.updated_at)}`}
                {" · "}
                <span>{orgRow.rule_count} rule{orgRow.rule_count === 1 ? "" : "s"}</span>
              </span>
            )}
          </div>

          {preview && <ParsedRulesView preview={preview} />}
        </>
      )}
    </Section>
  );
}

const ParsedRulesView = ({ preview }: { preview: SafeguardPreviewT }) => (
  <>
    <div className="eyebrow" style={{ margin: "32px 0 10px" }}>
      Parsed rules ({preview.rule_count})
    </div>
    {preview.warnings.length > 0 && (
      <div
        style={{
          padding: 10,
          marginBottom: 12,
          border: "1px solid var(--line)",
          borderLeft: "2px solid var(--warn)",
          borderRadius: "var(--radius)",
          background: "var(--bg-1)",
          fontSize: 12.5,
          color: "var(--ink-2)",
        }}
      >
        <div className="mono" style={{ color: "var(--warn)", marginBottom: 6 }}>
          {preview.warnings.length} WARNING{preview.warnings.length === 1 ? "" : "S"}
        </div>
        {preview.warnings.map((w, i) => (
          <WarningRow key={i} w={w} />
        ))}
      </div>
    )}
    {preview.rule_count === 0 ? (
      <div className="empty-hint">
        No rules parsed yet. Add a bullet starting with "Never X without approval".
      </div>
    ) : (
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {preview.rules.map((r, i) => (
          <RuleRow key={i} r={r} idx={i} />
        ))}
      </div>
    )}
  </>
);

const RuleRow = ({ r, idx }: { r: SafeguardParsedRule; idx: number }) => (
  <div
    style={{
      padding: "12px 16px",
      borderTop: idx ? "1px solid var(--line)" : 0,
      display: "grid",
      gridTemplateColumns: "90px 1fr",
      gap: 16,
      alignItems: "flex-start",
    }}
  >
    <span
      className="mono"
      style={{
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: EFFECT_TONE[r.effect],
        paddingTop: 2,
      }}
    >
      {r.effect}
    </span>
    <div>
      <div style={{ fontSize: 13 }}>{r.reason}</div>
      <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 4 }}>
        {[
          r.skill_slug ? `skill=${r.skill_slug}` : null,
          r.agent_kind ? `agent=${r.agent_kind}` : null,
          r.action_kind ? `action=${r.action_kind}` : null,
          `priority=${r.priority}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </div>
  </div>
);

const WarningRow = ({ w }: { w: SafeguardParseWarning }) => (
  <div style={{ marginTop: 4 }}>
    <span className="mono tiny" style={{ color: "var(--muted)" }}>
      line {w.line_number}:
    </span>{" "}
    <span style={{ color: "var(--ink-2)" }}>{w.message}</span>{" "}
    <span className="mono tiny" style={{ color: "var(--muted)" }}>
      "{w.line.length > 60 ? w.line.slice(0, 57) + "…" : w.line}"
    </span>
  </div>
);

// -- Connectors --------------------------------------------------------------

const PROVIDER_TONE: Record<string, string> = {
  ready:        "var(--pos)",
  needs_oauth:  "var(--info)",
  stub:         "var(--muted-2)",
};

function ConnectorsTab() {
  const providersQ = useFetch<{ providers: ConnectorProviderInfo[] }>(
    () => api.listConnectorProviders(),
    [],
  );
  const connectorsQ = useFetch<ConnectorRow[]>(() => api.listConnectors(), []);
  const [picker, setPicker] = useState<ConnectorProviderKey | null>(null);
  const [name, setName] = useState("");
  const [nangoId, setNangoId] = useState("");
  const [configJson, setConfigJson] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const providers = providersQ.data?.providers ?? [];
  const selectedProvider = providers.find((p) => p.key === picker) ?? null;
  const needsOauth = selectedProvider?.status === "needs_oauth";

  const reset = (): void => {
    setPicker(null);
    setName("");
    setNangoId("");
    setConfigJson("{}");
    setErr(null);
  };

  const onCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!picker || !name.trim() || busy) return;
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(configJson || "{}");
    } catch {
      setErr("Config must be valid JSON.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.createConnector({
        provider: picker,
        name: name.trim(),
        nango_connection_id: nangoId.trim() || null,
        config,
      });
      reset();
      await connectorsQ.refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section>
      <div className="h3" style={{ marginBottom: 8 }}>Connectors.</div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24, maxWidth: 620 }}>
        Sources that flow into the company brain on a schedule. Each
        configured connector pulls fresh content into <span className="mono">ops.document</span>,
        which the existing chunker indexes for search and the SOP→Skill
        pipeline. Two connectors work today; the rest need the Nango
        Connect flow (lands in follow-up sprints).
      </div>

      {/* Provider catalogue */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>Providers</div>
      {providersQ.loading && <Loading label="Loading providers…" />}
      {providersQ.error && <ErrorState error={providersQ.error} onRetry={providersQ.refetch} />}
      {!providersQ.loading && !providersQ.error && providers.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 10,
            marginBottom: 24,
          }}
        >
          {providers.map((p) => {
            const tone = PROVIDER_TONE[p.status] ?? "var(--muted)";
            const selected = picker === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPicker(p.key)}
                style={{
                  textAlign: "left",
                  padding: 14,
                  border: selected ? `2px solid ${tone}` : "1px solid var(--line)",
                  background: selected ? "var(--bg-2)" : "var(--bg-1)",
                  color: "var(--ink)",
                  borderRadius: "var(--radius-lg)",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: tone,
                    }}
                  />
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{p.label}</span>
                </div>
                <div className="tiny mono" style={{ color: "var(--muted)", marginBottom: 6 }}>
                  {p.status}
                </div>
                <div className="small" style={{ color: "var(--ink-2)", lineHeight: 1.4 }}>
                  {p.hint}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Create form */}
      {picker && (
        <form
          onSubmit={onCreate}
          style={{
            padding: 16,
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-lg)",
            background: "var(--bg-1)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <div className="eyebrow">
            New {selectedProvider?.label ?? picker} connector
          </div>
          <input
            placeholder="Name (e.g. 'Marketing Slack' or 'Wiki polls')"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={connectorInputStyle}
            autoFocus
          />
          {needsOauth && (
            <input
              placeholder="Nango connection id (from Nango Connect flow)"
              value={nangoId}
              onChange={(e) => setNangoId(e.target.value)}
              style={connectorInputStyle}
            />
          )}
          <div>
            <div className="tiny mono" style={{ color: "var(--muted)", marginBottom: 6 }}>
              Provider config (JSON)
            </div>
            <textarea
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              spellCheck={false}
              style={{
                ...connectorInputStyle,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                minHeight: 100,
                padding: 10,
                resize: "vertical",
              }}
            />
          </div>
          {err && (
            <div
              style={{
                padding: 10,
                border: "1px solid var(--line)",
                borderLeft: "2px solid var(--neg)",
                borderRadius: "var(--radius)",
                background: "var(--bg)",
                fontSize: 12.5,
                color: "var(--ink-2)",
              }}
            >
              <span className="mono" style={{ color: "var(--neg)", marginRight: 8 }}>FAILED</span>
              {err}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={busy || !name.trim()}
            >
              {busy ? "Creating…" : "Create connector"}
            </button>
            <button type="button" className="btn btn-sm" onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Active connectors */}
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        Configured connectors ({(connectorsQ.data ?? []).length})
      </div>
      {connectorsQ.loading && <Loading label="Loading connectors…" />}
      {connectorsQ.error && <ErrorState error={connectorsQ.error} onRetry={connectorsQ.refetch} />}
      {!connectorsQ.loading && !connectorsQ.error && (connectorsQ.data ?? []).length === 0 && (
        <Empty
          title="No connectors yet."
          hint="Pick a provider above to wire one up."
        />
      )}
      {!connectorsQ.loading && !connectorsQ.error && (connectorsQ.data ?? []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(connectorsQ.data ?? []).map((c) => (
            <ConnectorRowCard key={c.id} row={c} onChanged={connectorsQ.refetch} />
          ))}
        </div>
      )}
    </Section>
  );
}

const connectorInputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  outline: "none",
};

const ConnectorRowCard = ({ row, onChanged }: { row: ConnectorRow; onChanged: () => void }) => {
  const [busy, setBusy] = useState<"sync" | "toggle" | "delete" | null>(null);
  const [result, setResult] = useState<ConnectorSyncResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onSync = async (): Promise<void> => {
    if (busy) return;
    setBusy("sync");
    setErr(null);
    setResult(null);
    try {
      const r = await api.syncConnector(row.id);
      setResult(r);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const onToggle = async (): Promise<void> => {
    if (busy) return;
    setBusy("toggle");
    setErr(null);
    try {
      await api.patchConnector(row.id, { enabled: !row.enabled });
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const onDelete = async (): Promise<void> => {
    if (busy) return;
    if (!window.confirm(`Delete connector "${row.name}"? Its artifacts + linked documents stay.`)) return;
    setBusy("delete");
    setErr(null);
    try {
      await api.deleteConnector(row.id);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const statusTone = row.last_status === "ok"
    ? "var(--pos)"
    : row.last_status === "no_op"
      ? "var(--muted)"
      : row.last_status === "failed"
        ? "var(--neg)"
        : "var(--muted-2)";

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 14,
          alignItems: "flex-start",
        }}
      >
        <span
          style={{
            width: 6,
            alignSelf: "stretch",
            borderRadius: 2,
            minHeight: 36,
            background: row.enabled ? "var(--ink)" : "var(--muted-2)",
          }}
        />
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{row.name}</span>
            <span className="tiny mono" style={{ color: "var(--muted)" }}>{row.provider}</span>
            {!row.enabled && (
              <span className="pill" style={{ color: "var(--muted)" }}>disabled</span>
            )}
          </div>
          <div className="tiny mono" style={{ color: "var(--muted)" }}>
            every {Math.round(row.refresh_interval_seconds / 60)}m
            {" · "}
            last sync{" "}
            {row.last_synced_at ? relativeTime(row.last_synced_at) : "never"}
            {" · "}
            <span style={{ color: statusTone }}>
              {row.last_status ?? "—"}
            </span>
            {row.consecutive_failures > 0 && (
              <span style={{ color: "var(--warn)" }}>
                {" · "}
                {row.consecutive_failures} consecutive failure{row.consecutive_failures === 1 ? "" : "s"}
              </span>
            )}
            {row.nango_connection_id && (
              <>
                {" · "}
                <span>nango connected</span>
              </>
            )}
          </div>
          {row.last_error && (
            <div
              className="tiny"
              style={{
                marginTop: 6,
                color: "var(--neg)",
                maxWidth: 640,
                fontFamily: "var(--font-mono)",
                wordBreak: "break-word",
              }}
            >
              error: {row.last_error}
            </div>
          )}
          {result && (
            <div className="tiny" style={{ marginTop: 8, color: "var(--ink-2)" }}>
              <span className="mono" style={{ color: "var(--pos)" }}>just synced</span>
              {": "}
              +{result.artifacts_added} added · ~{result.artifacts_updated} updated · ={result.artifacts_unchanged} unchanged
              {result.warnings.length > 0 && (
                <>
                  {" · "}
                  <span style={{ color: "var(--warn)" }}>
                    {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}
                  </span>
                </>
              )}
            </div>
          )}
          {err && (
            <div
              className="tiny"
              style={{ marginTop: 6, color: "var(--neg)", fontFamily: "var(--font-mono)" }}
            >
              {err}
            </div>
          )}
        </div>
        <div className="stack-v" style={{ alignItems: "flex-end", gap: 6 }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onSync}
            disabled={busy !== null}
          >
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
          <button type="button" className="btn btn-sm" onClick={onToggle} disabled={busy !== null}>
            {row.enabled ? "Disable" : "Enable"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDelete} disabled={busy !== null}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

// -- Performance memory ------------------------------------------------------

const METRIC_DIRECTION_TONE: Record<string, string> = {
  higher_is_better: "var(--pos)",
  lower_is_better:  "var(--info)",
  informational:    "var(--muted)",
};

function PerformanceTab() {
  const outcomesQ = useFetch<OutcomeRow[]>(
    () => api.listOutcomes({ limit: 50 }),
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <Section>
      <div className="h3" style={{ marginBottom: 8 }}>Performance memory.</div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24, maxWidth: 620 }}>
        Past outputs the team produced, plus the metrics that landed against
        each. The next time an agent runs the same skill, the top-3
        successful past outputs (ranked by feedback rating + metric direction)
        get injected as few-shot context — your team gets measurably better
        at its repeat tasks without any retraining.
      </div>

      {outcomesQ.loading && <Loading label="Loading outcomes…" />}
      {outcomesQ.error && <ErrorState error={outcomesQ.error} onRetry={outcomesQ.refetch} />}

      {!outcomesQ.loading && !outcomesQ.error && (outcomesQ.data ?? []).length === 0 && (
        <Empty
          title="No outcomes recorded yet."
          hint='Record one with `POST /api/runs/:id/outcomes` after a successful skill run; the few-shot loop populates itself from there.'
        />
      )}

      {!outcomesQ.loading && !outcomesQ.error && (outcomesQ.data ?? []).length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 380px",
            gap: 16,
            alignItems: "flex-start",
          }}
        >
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {(outcomesQ.data ?? []).map((o, i) => {
              const selected = selectedId === o.id;
              return (
                <div
                  key={o.id}
                  onClick={() => setSelectedId(o.id)}
                  style={{
                    padding: "12px 16px",
                    borderTop: i ? "1px solid var(--line)" : 0,
                    cursor: "pointer",
                    background: selected ? "var(--bg-2)" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: 10.5,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--muted)",
                      }}
                    >
                      {o.output_kind}
                    </span>
                    {o.skill_slug && (
                      <span className="tiny mono" style={{ color: "var(--muted)" }}>
                        {o.skill_slug}
                      </span>
                    )}
                    <span
                      className="tiny mono"
                      style={{ color: "var(--muted)", marginLeft: "auto" }}
                    >
                      {relativeTime(o.created_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>
                    {o.title}
                  </div>
                  <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 4 }}>
                    {o.char_count} chars
                    {o.agent_kind && ` · agent=${o.agent_kind}`}
                    {o.run_id && ` · run ${o.run_id.slice(0, 8)}`}
                  </div>
                </div>
              );
            })}
          </div>
          <OutcomeDetail outcomeId={selectedId} />
        </div>
      )}
    </Section>
  );
}

const OutcomeDetail = ({ outcomeId }: { outcomeId: string | null }) => {
  const detailQ = useFetch<{
    id: string;
    title: string;
    output_kind: string;
    content_md: string;
    metrics: OutcomeMetricRow[];
    created_at: string;
  } | null>(
    () => (outcomeId ? api.getOutcome(outcomeId) : Promise.resolve(null)),
    [outcomeId],
  );

  if (!outcomeId) {
    return (
      <div
        className="card"
        style={{
          padding: 18,
          fontSize: 12.5,
          color: "var(--muted)",
          fontStyle: "italic",
          fontFamily: "var(--font-serif)",
        }}
      >
        Select an outcome on the left to inspect it.
      </div>
    );
  }
  if (detailQ.loading) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <Loading label="Loading…" />
      </div>
    );
  }
  if (detailQ.error) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <ErrorState error={detailQ.error} onRetry={detailQ.refetch} />
      </div>
    );
  }
  const d = detailQ.data;
  if (!d) return null;
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{d.output_kind}</div>
      <div className="h4" style={{ marginBottom: 12 }}>{d.title}</div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Metrics ({d.metrics.length})</div>
      {d.metrics.length === 0 ? (
        <div className="tiny" style={{ color: "var(--muted)", fontStyle: "italic" }}>
          No metrics recorded yet. POST one to{" "}
          <span className="mono">/api/outcomes/{d.id.slice(0, 8)}/metrics</span>.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {d.metrics.map((m) => (
            <div
              key={m.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                padding: "8px 10px",
                border: "1px solid var(--line)",
                borderLeft: `2px solid ${
                  METRIC_DIRECTION_TONE[m.direction] ?? "var(--muted)"
                }`,
                borderRadius: "var(--radius)",
                background: "var(--bg-1)",
                alignItems: "baseline",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                <div className="tiny mono" style={{ color: "var(--muted)" }}>
                  {m.direction} · {m.source} · {relativeTime(m.recorded_at)}
                </div>
              </div>
              <div className="num" style={{ fontSize: 14 }}>
                {Number(m.value).toLocaleString()}
                {m.unit && (
                  <span className="tiny mono" style={{ color: "var(--muted)", marginLeft: 4 }}>
                    {m.unit}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div
        className="eyebrow"
        style={{ marginTop: 16, marginBottom: 6 }}
      >
        Output preview
      </div>
      <pre
        style={{
          margin: 0,
          padding: 10,
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
          background: "var(--bg-1)",
          color: "var(--ink-2)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.5,
          maxHeight: 220,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {d.content_md.slice(0, 2_000)}
        {d.content_md.length > 2_000 ? "\n\n…(truncated)" : ""}
      </pre>
    </div>
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
  const membersQ = useFetch<OrgMember[]>(() => api.listOrgMembers(), []);
  const invitesQ = useFetch<InvitationRow[]>(() => api.listInvitations({ limit: 50 }), []);
  const deptsQ = useFetch<Department[]>(() => api.listDepartments(), []);
  const [composing, setComposing] = useState(false);

  const pendingInvites = (invitesQ.data ?? []).filter((i) => i.status === "pending");
  const otherInvites = (invitesQ.data ?? []).filter((i) => i.status !== "pending");

  return (
    <Section>
      <div className="h3" style={{ marginBottom: 8 }}>People & roles.</div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24, maxWidth: 620 }}>
        Three roles: <b>Founder</b> sees everything and decides. <b>Manager</b> runs a department.
        <b> Contributor</b> works on assigned tasks. Agents inherit the role of their manager.
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <div className="eyebrow">Pending invitations ({pendingInvites.length})</div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setComposing(true)}
        >
          <I name="plus" size={12} /> Invite person
        </button>
      </div>

      {composing && (
        <InviteComposer
          departments={deptsQ.data ?? []}
          onClose={() => setComposing(false)}
          onCreated={() => {
            setComposing(false);
            invitesQ.refetch();
          }}
        />
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        {invitesQ.loading && !invitesQ.data && (
          <div className="empty-hint" style={{ padding: 14 }}>Loading invitations…</div>
        )}
        {invitesQ.error && (
          <div style={{ padding: 14 }}>
            <InlineError
              error={invitesQ.error}
              context="invitations"
              onRetry={() => invitesQ.refetch()}
            />
          </div>
        )}
        {!invitesQ.loading && pendingInvites.length === 0 && (
          <div className="empty-hint" style={{ padding: 14 }}>
            No pending invitations. Use <span className="mono">Invite person</span> to send one.
          </div>
        )}
        {pendingInvites.map((inv, i) => (
          <InvitationRowItem
            key={inv.id}
            inv={inv}
            isFirst={i === 0}
            onChanged={() => invitesQ.refetch()}
          />
        ))}
        {otherInvites.length > 0 && (
          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px solid var(--line)",
              background: "var(--bg-2)",
              fontSize: 11,
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            History · {otherInvites.length}
          </div>
        )}
        {otherInvites.map((inv) => (
          <InvitationRowItem key={inv.id} inv={inv} muted onChanged={() => invitesQ.refetch()} />
        ))}
      </div>

      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Members ({membersQ.data?.length ?? "—"})
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 200px 140px 90px",
            padding: "12px 16px",
            borderBottom: "1px solid var(--line)",
            background: "var(--bg-2)",
          }}
        >
          {["Member", "Role · Department", "Joined", "Active"].map((h) => (
            <div key={h} className="eyebrow">{h}</div>
          ))}
        </div>
        {membersQ.loading && !membersQ.data && (
          <div className="empty-hint" style={{ padding: 16 }}>Loading members…</div>
        )}
        {membersQ.error && (
          <div style={{ padding: 14 }}>
            <InlineError
              error={membersQ.error}
              context="members"
              onRetry={() => membersQ.refetch()}
            />
          </div>
        )}
        {(membersQ.data ?? []).length === 0 && !membersQ.loading && (
          <div className="empty-hint" style={{ padding: 16 }}>
            No members yet. Invite flow lands in Phase 6.b.
          </div>
        )}
        {(membersQ.data ?? []).map((m, i) => (
          <div
            key={m.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 200px 140px 90px",
              padding: "12px 16px",
              borderTop: i ? "1px solid var(--line)" : 0,
              fontSize: 13,
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>{m.full_name ?? m.email}</div>
              {m.full_name && (
                <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 2 }}>
                  {m.email}
                </div>
              )}
            </div>
            <div className="tiny mono" style={{ color: "var(--ink-2)" }}>
              {(m.role ?? "no role")}
              {m.department_name && ` · ${m.department_name}`}
            </div>
            <div className="tiny mono" style={{ color: "var(--muted)" }}>
              {new Date(m.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
            <div className="tiny mono">
              <span className={`dot ${m.is_active ? "pos" : "idle"}`} />{" "}
              {m.is_active ? "active" : "inactive"}
            </div>
          </div>
        ))}
      </div>

      <ReadOnlyBanner what="Role mutations on existing members" />

      <div className="eyebrow" style={{ marginTop: 8, marginBottom: 8 }}>Capability matrix</div>
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

// -- Invitations -------------------------------------------------------------

const ROLE_OPTIONS: { value: InvitableRole; label: string; hint: string }[] = [
  { value: "team_member",     label: "Team member",     hint: "works on assigned tasks" },
  { value: "department_lead", label: "Department lead", hint: "runs a department" },
  { value: "auditor",         label: "Auditor",         hint: "read-only across the org" },
  { value: "owner",           label: "Owner",           hint: "full access · use sparingly" },
];

function InviteComposer({
  departments,
  onClose,
  onCreated,
}: {
  departments: Department[];
  onClose: () => void;
  onCreated: (created: InvitationRow) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("team_member");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<InvitationRow | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const inv = await api.createInvitation({
        email: email.trim(),
        role,
        department_id: departmentId || null,
      });
      setCreated(inv);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const close = (): void => {
    if (created) onCreated(created);
    onClose();
  };

  if (created) {
    const url = created.invite_url ?? "";
    return (
      <div
        style={{
          padding: 16,
          border: "1px solid var(--line)",
          borderLeft: "2px solid var(--pos)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-1)",
          marginBottom: 16,
        }}
      >
        <div className="eyebrow" style={{ color: "var(--pos)", marginBottom: 6 }}>
          Invitation created
        </div>
        <div className="small" style={{ color: "var(--ink-2)", marginBottom: 12 }}>
          Send this link to <span className="mono">{created.email}</span>. It expires in 7 days.
          Email delivery isn't wired yet — share the link via your channel of choice.
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "stretch",
            marginBottom: 12,
          }}
        >
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              flex: 1,
              padding: "8px 10px",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius)",
              background: "var(--bg)",
              color: "var(--ink-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              } catch {
                // ignore
              }
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <button type="button" className="btn btn-sm" onClick={close}>
          Done
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        padding: 16,
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-1)",
        marginBottom: 16,
        display: "grid",
        gap: 10,
      }}
    >
      <div className="eyebrow">New invitation</div>
      <input
        autoFocus
        type="email"
        placeholder="email@theirdomain.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        style={inputStyle}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as InvitableRole)}
          style={inputStyle}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label} — {r.hint}
            </option>
          ))}
        </select>
        <select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          style={inputStyle}
        >
          <option value="">No department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      {err && <div className="tiny" style={{ color: "var(--neg)" }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={busy || !email.trim()}
        >
          {busy ? "Inviting…" : "Send invite"}
        </button>
      </div>
    </form>
  );
}

function InvitationRowItem({
  inv,
  isFirst,
  muted,
  onChanged,
}: {
  inv: InvitationRow;
  isFirst?: boolean;
  muted?: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"revoke" | "resend" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onRevoke = async (): Promise<void> => {
    if (busy) return;
    if (!window.confirm(`Revoke invitation for ${inv.email}? Their link will stop working.`)) return;
    setBusy("revoke");
    setErr(null);
    try {
      await api.revokeInvitation(inv.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onResend = async (): Promise<void> => {
    if (busy) return;
    setBusy("resend");
    setErr(null);
    try {
      await api.resendInvitation(inv.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onCopy = async (): Promise<void> => {
    if (!inv.invite_url) return;
    try {
      await navigator.clipboard.writeText(inv.invite_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };

  const tone =
    inv.status === "pending"   ? "var(--info)"
    : inv.status === "accepted" ? "var(--pos)"
    : inv.status === "revoked"  ? "var(--muted)"
    : "var(--warn)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 200px 220px",
        gap: 12,
        padding: "12px 16px",
        borderTop: isFirst ? 0 : "1px solid var(--line)",
        alignItems: "center",
        opacity: muted ? 0.7 : 1,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{inv.email}</div>
        <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 2 }}>
          {inv.role}
          {inv.department_name && ` · ${inv.department_name}`}
          · expires {new Date(inv.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </div>
        {err && <div className="tiny" style={{ color: "var(--neg)", marginTop: 4 }}>{err}</div>}
      </div>
      <div>
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: tone,
          }}
        >
          {inv.status}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {inv.status === "pending" && inv.invite_url && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCopy}>
            {copied ? "Copied" : "Copy link"}
          </button>
        )}
        {inv.status === "pending" && (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onResend}
              disabled={busy !== null}
            >
              {busy === "resend" ? "…" : "Resend"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onRevoke}
              disabled={busy !== null}
            >
              {busy === "revoke" ? "…" : "Revoke"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = {
  height: 34,
  padding: "0 10px",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  outline: "none",
};

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

// -- Onboarding --------------------------------------------------------------

const DERIVED_LABELS: Array<{ key: keyof OnboardingDerived; label: string }> = [
  { key: "voice_words",         label: "Voice" },
  { key: "banned_words",        label: "Banned" },
  { key: "decision_categories", label: "Always asks you" },
  { key: "channels",            label: "Active channels" },
  { key: "routine_hints",       label: "Cadence cues" },
];

function OnboardingTab({ onReopen }: { onReopen?: () => void }) {
  const profileQ = useFetch<OnboardingProfile | null>(() => api.onboardingProfile(), []);
  const profile = profileQ.data;
  const derived = (profile?.derived ?? {}) as OnboardingDerived;
  const totalAnswered = profile?.answers.length ?? 0;
  const completed = Boolean(profile?.completed_at);
  const briefingHour = derived.briefing_hour_utc;

  const reopen = (): void => {
    // Clear both storages — sessionStorage is the new home for the
    // dismissal flag, but legacy users might still have it in
    // localStorage from before the bug fix. Wipe both, then ask the
    // App to open the wizard now.
    window.localStorage.removeItem("bc.onboarding.dismissed");
    window.sessionStorage.removeItem("bc.onboarding.dismissed");
    onReopen?.();
  };

  return (
    <Section>
      <div className="h3" style={{ marginBottom: 8 }}>Onboarding.</div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24, maxWidth: 620 }}>
        Your answers from the welcome interview shape the studio's voice, the
        decisions Hermes always asks you about, and the routine drafts in your
        Goals list. Re-open the wizard any time to refine them.
      </div>

      {profileQ.loading && !profile && (
        <div className="empty-hint" style={{ padding: 16 }}>Loading profile…</div>
      )}
      {profileQ.error && (
        <InlineError
          error={profileQ.error}
          context="onboarding profile"
          onRetry={() => profileQ.refetch()}
          style={{ marginBottom: 14 }}
        />
      )}

      {!profileQ.loading && !profile && (
        <div className="card" style={{ padding: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>No profile yet</div>
          <div className="small" style={{ color: "var(--ink-2)", marginBottom: 14 }}>
            Run the wizard to capture your studio's voice and seed routine drafts.
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={reopen}
            disabled={!onReopen}
          >
            Start onboarding
          </button>
        </div>
      )}

      {profile && (
        <>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <div className="eyebrow">Status</div>
              <span
                className="mono"
                style={{
                  fontSize: 10.5,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: completed ? "var(--pos)" : "var(--warn)",
                }}
              >
                {completed ? "complete" : "in progress"}
              </span>
            </div>
            <div style={{ fontSize: 14, marginBottom: 6 }}>
              {totalAnswered} answer{totalAnswered === 1 ? "" : "s"} on file
              {completed && profile.completed_at
                ? ` · finished ${relativeTime(profile.completed_at)}`
                : ""}
            </div>
            <div className="tiny mono" style={{ color: "var(--muted)" }}>
              mode={profile.mode} · started {relativeTime(profile.created_at)}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={reopen}
                disabled={!onReopen}
              >
                {completed ? "Re-open wizard" : "Resume wizard"}
              </button>
            </div>
          </div>

          <div className="eyebrow" style={{ marginBottom: 8 }}>Derived from your answers</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {DERIVED_LABELS.map(({ key, label }) => {
              const value = derived[key];
              const hasValue = Array.isArray(value) && value.length > 0;
              return (
                <div
                  key={String(key)}
                  style={{
                    padding: "12px 14px",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--radius)",
                    background: "var(--bg-1)",
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      marginBottom: 4,
                    }}
                  >
                    {label}
                  </div>
                  <div style={{ fontSize: 13, color: hasValue ? "var(--ink)" : "var(--muted)" }}>
                    {hasValue ? (value as string[]).join(", ") : "—"}
                  </div>
                </div>
              );
            })}
            {briefingHour !== undefined && (
              <div
                style={{
                  padding: "12px 14px",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius)",
                  background: "var(--bg-1)",
                }}
              >
                <div
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--muted)",
                    marginBottom: 4,
                  }}
                >
                  Briefing hour (UTC)
                </div>
                <div style={{ fontSize: 13 }}>{briefingHour}</div>
              </div>
            )}
          </div>

          {profile.answers.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Answers</div>
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                {profile.answers.map((a, i) => (
                  <div
                    key={a.question_id}
                    style={{
                      padding: "14px 16px",
                      borderTop: i ? "1px solid var(--line)" : 0,
                    }}
                  >
                    <div className="tiny mono" style={{ color: "var(--muted)", marginBottom: 4 }}>
                      {a.question_id} · {relativeTime(a.asked_at)}
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 4 }}>
                      {a.question}
                    </div>
                    <div className="small" style={{ color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>
                      {a.answer || <span style={{ color: "var(--muted)" }}>(skipped)</span>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Section>
  );
}

// -- Memory ------------------------------------------------------------------
//
// Read-only surface over the three memory layers we already store:
//   - Identity:  ops.knowledge_doc (hot or scope=company)
//   - Context:   ops.goal_context (per-goal markdown)
//   - History:   brain.memory (Hermes episodes + Phase 9.2 wrap-ups)
//
// Editing flows live in their natural homes (Goal Detail for context,
// the existing knowledge tooling for identity). This tab is the
// single pane that says "here is what your agents know."

function MemoryTab() {
  const memQ = useFetch<MemoryExploreResponse>(
    () => api.exploreMemory({ historyLimit: 50 }),
    [],
  );
  const data = memQ.data;
  const counts = {
    identity: data?.identity.length ?? 0,
    context: data?.context.length ?? 0,
    history: data?.history.length ?? 0,
  };

  // Phase 9.5 — inline web ingest. One URL input, one button. Lean.
  const [url, setUrl] = useState("");
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestErr, setIngestErr] = useState<string | null>(null);
  const [ingestOk, setIngestOk] = useState<string | null>(null);

  const onIngest = async (): Promise<void> => {
    const trimmed = url.trim();
    if (!trimmed || ingestBusy) return;
    setIngestBusy(true);
    setIngestErr(null);
    setIngestOk(null);
    try {
      const result = await api.ingestUrlToMemory({ url: trimmed });
      setIngestOk(`Ingested "${result.title}" (${result.length.toLocaleString()} chars${result.truncated ? ", truncated" : ""})`);
      setUrl("");
      memQ.refetch();
    } catch (e) {
      setIngestErr(e instanceof Error ? e.message : String(e));
    } finally {
      setIngestBusy(false);
    }
  };

  return (
    <Section>
      <div className="h3" style={{ marginBottom: 8 }}>Memory.</div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24, maxWidth: 620 }}>
        Three layers. <b>Identity</b> is what every agent always knows about
        your studio. <b>Context</b> is what each goal carries between runs.
        <b> History</b> is the narrative record — what your agents have done
        and learned. All loaded automatically; nothing to wire by hand.
      </div>

      <div
        style={{
          padding: 14,
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-1)",
          marginBottom: 24,
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 8 }}>Ingest a web page</div>
        <div className="small" style={{ color: "var(--ink-2)", marginBottom: 12 }}>
          Drop any URL — we fetch it, extract the text, and store it as a
          memory your agents can recall. Works for articles, docs, blog
          posts. JavaScript-only sites won't extract well.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onIngest();
              }
            }}
            disabled={ingestBusy}
            style={{
              flex: 1,
              height: 34,
              padding: "0 12px",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius)",
              background: "var(--bg)",
              color: "var(--ink)",
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              outline: "none",
            }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void onIngest()}
            disabled={ingestBusy || !url.trim()}
          >
            {ingestBusy ? "Fetching…" : "Ingest"}
          </button>
        </div>
        {ingestErr && (
          <div className="tiny" style={{ color: "var(--neg)", marginTop: 8 }}>
            {ingestErr}
          </div>
        )}
        {ingestOk && (
          <div className="tiny" style={{ color: "var(--pos)", marginTop: 8 }}>
            {ingestOk}
          </div>
        )}
      </div>

      {memQ.loading && !data && (
        <div className="empty-hint" style={{ padding: 16 }}>Loading memory…</div>
      )}
      {memQ.error && (
        <InlineError
          error={memQ.error}
          context="memory"
          onRetry={() => memQ.refetch()}
          style={{ marginBottom: 14 }}
        />
      )}

      {data && (
        <>
          <MemoryLayerHeader
            label="Layer 1 · Identity"
            sub="loaded into every agent prompt"
            count={counts.identity}
          />
          {data.identity.length === 0 ? (
            <div className="empty-hint" style={{ padding: 14 }}>
              No identity docs yet. The onboarding wizard creates one
              automatically; you can also paste your own under Skills →
              Knowledge.
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
              {data.identity.map((d, i) => (
                <div
                  key={d.id}
                  style={{
                    padding: "14px 16px",
                    borderTop: i ? "1px solid var(--line)" : 0,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{d.title}</div>
                    <div className="tiny mono" style={{ color: "var(--muted)" }}>
                      {d.hot ? "hot · " : ""}{d.scope} · {relativeTime(d.updated_at)}
                    </div>
                  </div>
                  <div className="small" style={{ color: "var(--ink-2)", whiteSpace: "pre-wrap", maxHeight: 90, overflow: "hidden" }}>
                    {d.content_md.slice(0, 360)}
                    {d.content_md.length > 360 && <span style={{ color: "var(--muted)" }}>…</span>}
                  </div>
                  {d.tags.length > 0 && (
                    <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 6 }}>
                      {d.tags.map((t) => `#${t}`).join(" ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <MemoryLayerHeader
            label="Layer 2 · Context"
            sub="loaded when the agent works on a specific goal"
            count={counts.context}
          />
          {data.context.length === 0 ? (
            <div className="empty-hint" style={{ padding: 14 }}>
              No goal contexts yet. Open any goal → the <b>Context</b> section
              accepts notes the agent should always remember about that goal.
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
              {data.context.map((c, i) => (
                <div
                  key={c.goal_id}
                  style={{
                    padding: "14px 16px",
                    borderTop: i ? "1px solid var(--line)" : 0,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.goal_title}</div>
                    <div className="tiny mono" style={{ color: "var(--muted)" }}>
                      {c.goal_kind} · {c.goal_status} · {relativeTime(c.updated_at)}
                    </div>
                  </div>
                  <div className="small" style={{ color: "var(--ink-2)", whiteSpace: "pre-wrap", maxHeight: 90, overflow: "hidden" }}>
                    {c.content_md.slice(0, 360)}
                    {c.content_md.length > 360 && <span style={{ color: "var(--muted)" }}>…</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <MemoryLayerHeader
            label="Layer 3 · History"
            sub="auto-recorded after each run"
            count={counts.history}
          />
          {data.history.length === 0 ? (
            <div className="empty-hint" style={{ padding: 14 }}>
              No memories yet. As runs complete, summaries land here.
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {data.history.map((h, i) => (
                <div
                  key={h.id}
                  style={{
                    padding: "12px 16px",
                    borderTop: i ? "1px solid var(--line)" : 0,
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 12,
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: h.kind === "episode" ? "var(--info)" : h.kind === "fact" ? "var(--warn)" : "var(--muted)",
                      paddingTop: 2,
                    }}
                  >
                    {h.kind}
                  </span>
                  <div>
                    {h.title && (
                      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{h.title}</div>
                    )}
                    <div className="small" style={{ color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {h.content.slice(0, 320)}
                      {h.content.length > 320 && <span style={{ color: "var(--muted)" }}>…</span>}
                    </div>
                    {h.goal_title && (
                      <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 4 }}>
                        goal: {h.goal_title}
                      </div>
                    )}
                  </div>
                  <div className="tiny mono" style={{ color: "var(--muted)" }}>
                    {relativeTime(h.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function MemoryLayerHeader({
  label,
  sub,
  count,
}: {
  label: string;
  sub: string;
  count: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: 10,
      }}
    >
      <div>
        <div className="eyebrow">{label}</div>
        <div className="tiny" style={{ color: "var(--muted)", marginTop: 2 }}>{sub}</div>
      </div>
      <span className="pill">{count}</span>
    </div>
  );
}

// -- Billing -----------------------------------------------------------------

const STATUS_TONE: Record<SubscriptionRow["status"], string> = {
  trialing:           "var(--info)",
  active:             "var(--pos)",
  past_due:           "var(--warn)",
  canceled:           "var(--muted)",
  unpaid:             "var(--neg)",
  incomplete:         "var(--warn)",
  incomplete_expired: "var(--neg)",
  paused:             "var(--muted)",
};

function BillingTab() {
  const subQ = useFetch<SubscriptionRow>(() => api.getSubscription(), []);
  const plansQ = useFetch<{ plans: PricingPlan[] }>(() => api.listPricingPlans(), []);
  const sub = subQ.data;
  const plans = plansQ.data?.plans ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [billingErr, setBillingErr] = useState<string | null>(null);

  const startCheckout = async (tier: string): Promise<void> => {
    if (busy) return;
    setBusy(tier);
    setBillingErr(null);
    try {
      const session = await api.createCheckoutSession({ tier });
      window.location.href = session.url;
    } catch (e) {
      setBillingErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async (): Promise<void> => {
    if (busy) return;
    setBusy("portal");
    setBillingErr(null);
    try {
      const session = await api.createPortalSession();
      window.location.href = session.url;
    } catch (e) {
      setBillingErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section>
      <div className="h3" style={{ marginBottom: 8 }}>Billing.</div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24, maxWidth: 620 }}>
        Subscription state mirrors Stripe via webhook. Free tier is the default
        — paid plans light up automatically once a Stripe checkout completes.
      </div>

      {subQ.loading && !sub && (
        <div className="empty-hint" style={{ padding: 16 }}>Loading subscription…</div>
      )}
      {subQ.error && (
        <div
          style={{
            padding: 14,
            border: "1px solid var(--line)",
            borderLeft: "2px solid var(--neg)",
            borderRadius: "var(--radius)",
            background: "var(--bg-1)",
            marginBottom: 16,
          }}
        >
          <div className="eyebrow" style={{ color: "var(--neg)", marginBottom: 6 }}>
            Couldn't load subscription
          </div>
          <div className="small">{subQ.error.message}</div>
        </div>
      )}

      {sub && (
        <div className="card" style={{ padding: 24, marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <div className="eyebrow">Current plan</div>
            <span
              className="mono"
              style={{
                fontSize: 10.5,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: STATUS_TONE[sub.status],
              }}
            >
              {sub.status}
            </span>
          </div>
          <div className="h2" style={{ marginBottom: 4, textTransform: "capitalize" }}>
            {sub.tier}
            {sub.is_free && (
              <span style={{ fontSize: 18, color: "var(--muted)", marginLeft: 8 }}>
                · OSS
              </span>
            )}
          </div>
          <div className="small" style={{ color: "var(--ink-2)" }}>
            {sub.is_free
              ? "Self-hosted local mode. No subscription needed."
              : sub.current_period_end
              ? sub.cancel_at_period_end
                ? `Ends ${new Date(sub.current_period_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                : `Renews ${new Date(sub.current_period_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
              : "Active subscription"}
            {sub.trial_end && new Date(sub.trial_end) > new Date() && (
              <>
                {" · trial ends "}
                {new Date(sub.trial_end).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
            {!sub.is_free && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={openPortal}
                disabled={busy !== null}
              >
                {busy === "portal" ? "Opening…" : "Manage plan"}
              </button>
            )}
            {sub.stripe_customer_id && (
              <span className="tiny mono" style={{ color: "var(--muted)" }}>
                stripe.{sub.stripe_customer_id.slice(0, 14)}…
              </span>
            )}
          </div>
        </div>
      )}

      {billingErr && (
        <div
          style={{
            padding: 12,
            border: "1px solid var(--line)",
            borderLeft: "2px solid var(--neg)",
            borderRadius: "var(--radius)",
            background: "var(--bg-1)",
            marginBottom: 16,
            fontSize: 12.5,
            color: "var(--ink-2)",
          }}
        >
          <span className="mono" style={{ color: "var(--neg)", marginRight: 8 }}>
            BILLING ERROR
          </span>
          {billingErr}
        </div>
      )}

      {sub?.is_free && plans.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Upgrade</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(plans.length, 2)}, 1fr)`,
              gap: 12,
            }}
          >
            {plans.map((plan) => (
              <div
                key={plan.tier}
                style={{
                  padding: 18,
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-lg)",
                  background: "var(--bg-1)",
                }}
              >
                <div className="eyebrow" style={{ marginBottom: 6 }}>{plan.name}</div>
                <div className="h3" style={{ marginBottom: 8 }}>{plan.price_display}</div>
                <ul style={{ paddingLeft: 18, margin: "0 0 14px 0", fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)" }}>
                  {plan.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ width: "100%" }}
                  onClick={() => startCheckout(plan.tier)}
                  disabled={busy !== null}
                >
                  {busy === plan.tier ? "Redirecting…" : `Upgrade to ${plan.name}`}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {sub?.is_free && plans.length === 0 && !plansQ.loading && (
        <div
          style={{
            padding: 14,
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius-lg)",
            color: "var(--muted)",
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          No paid tiers configured yet. Set <span className="mono">STRIPE_PRICE_ID_PRO</span> /{" "}
          <span className="mono">STRIPE_PRICE_ID_STUDIO</span> in <span className="mono">.env</span>{" "}
          to surface upgrade options.
        </div>
      )}

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
