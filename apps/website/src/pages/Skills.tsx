import { useState } from "react";

import type {
  SkillDraftRow,
  SkillDraftStatus,
  SkillRow,
} from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useFetch } from "../lib/useFetch";
import { Empty, ErrorState, Loading } from "../components/States";

type DraftFilter = "draft" | "promoted" | "rejected" | "all";

const FILTERS: { key: DraftFilter; label: string }[] = [
  { key: "draft",     label: "Pending" },
  { key: "promoted",  label: "Promoted" },
  { key: "rejected",  label: "Rejected" },
  { key: "all",       label: "All" },
];

export function Skills() {
  const skillsQ = useFetch<SkillRow[]>(() => api.listSkills(), []);
  const [filter, setFilter] = useState<DraftFilter>("draft");
  const draftsQ = useFetch<SkillDraftRow[]>(
    () => api.listSkillDrafts(filter === "all" ? {} : { status: filter as SkillDraftStatus }),
    [filter],
  );

  const [docId, setDocId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);

  const onGenerate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (generating || !docId.trim()) return;
    setGenerating(true);
    setGenErr(null);
    try {
      await api.generateSkillDraft(docId.trim());
      setDocId("");
      // Move user to the Pending tab + refetch.
      setFilter("draft");
      await draftsQ.refetch();
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="meta">
          <div className="editorial-eyebrow">Skills · live</div>
          <div className="titlerow">
            <div className="h1">Skills.</div>
          </div>
          <div className="small" style={{ maxWidth: 620, marginTop: 4 }}>
            Reusable capabilities your team can pick up. Each skill is
            versioned, testable, and composable. Generate new ones from any
            document you've ingested — paste a document id below.
          </div>
        </div>
        <div className="stack-h">
          <button className="btn btn-sm" onClick={() => { skillsQ.refetch(); draftsQ.refetch(); }}>
            <I name="spark" size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Generator */}
      <div className="section">
        <div className="section-head">
          <div className="stack-h">
            <span className="title">Generate from a document</span>
            <span className="pill">SOP → Skill</span>
          </div>
        </div>
        <form
          onSubmit={onGenerate}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 8,
            alignItems: "center",
            maxWidth: 720,
          }}
        >
          <input
            placeholder='Document id from `bc docs` (e.g. "a1b2c3d4-...")'
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            style={{
              height: 36,
              padding: "0 10px",
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
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={generating || !docId.trim()}
          >
            {generating ? "Extracting…" : "Generate draft"}
          </button>
        </form>
        {genErr && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              border: "1px solid var(--line)",
              borderLeft: "2px solid var(--neg)",
              borderRadius: "var(--radius)",
              background: "var(--bg-1)",
              fontSize: 12.5,
              color: "var(--ink-2)",
              maxWidth: 720,
            }}
          >
            <span className="mono" style={{ color: "var(--neg)", marginRight: 8 }}>FAILED</span>
            {genErr}
          </div>
        )}
        <div className="tiny" style={{ color: "var(--muted)", marginTop: 10, maxWidth: 620 }}>
          Need a document id? In your terminal, run <span className="mono">bc docs</span> to list
          ingested SOPs. Without Portkey configured, the extractor falls back to a deterministic
          markdown parser.
        </div>
      </div>

      {/* Drafts */}
      <div className="section">
        <div className="section-head">
          <div className="stack-h">
            <span className="title">Drafts</span>
            <span className="pill">{(draftsQ.data ?? []).length}</span>
          </div>
          <div className="seg">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={filter === f.key ? "on" : ""}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {draftsQ.loading && <Loading label="Loading drafts…" />}
        {draftsQ.error && <ErrorState error={draftsQ.error} onRetry={draftsQ.refetch} />}
        {!draftsQ.loading && !draftsQ.error && (draftsQ.data ?? []).length === 0 && (
          <Empty
            title={
              filter === "draft"
                ? "No pending drafts."
                : `No ${filter} drafts.`
            }
            hint="Paste a document id above to generate one."
          />
        )}
        {!draftsQ.loading && !draftsQ.error && (draftsQ.data ?? []).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(draftsQ.data ?? []).map((d) => (
              <DraftCard key={d.id} draft={d} onChanged={draftsQ.refetch} />
            ))}
          </div>
        )}
      </div>

      {/* Existing skills */}
      <div className="section">
        <div className="section-head">
          <div className="stack-h">
            <span className="title">Active skills</span>
            <span className="pill">{(skillsQ.data ?? []).length}</span>
          </div>
        </div>
        {skillsQ.loading && <Loading label="Loading skills…" />}
        {skillsQ.error && <ErrorState error={skillsQ.error} onRetry={skillsQ.refetch} />}
        {!skillsQ.loading && !skillsQ.error && (skillsQ.data ?? []).length === 0 && (
          <Empty title="No skills yet." hint="Promote a draft above to add one." />
        )}
        {!skillsQ.loading && !skillsQ.error && (skillsQ.data ?? []).length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {(skillsQ.data ?? []).map((s) => <SkillCard key={s.id} skill={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_TONE: Record<SkillDraftStatus, string> = {
  draft:    "var(--info)",
  promoted: "var(--pos)",
  rejected: "var(--muted-2)",
};

const DraftCard = ({ draft, onChanged }: { draft: SkillDraftRow; onChanged: () => void }) => {
  const [busy, setBusy] = useState<"promote" | "reject" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const onPromote = async (): Promise<void> => {
    if (busy) return;
    setBusy("promote");
    setErr(null);
    try {
      await api.promoteSkillDraft(draft.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };
  const onReject = async (): Promise<void> => {
    if (busy) return;
    if (!window.confirm("Reject this draft? It stays in history but won't be promoted.")) return;
    setBusy("reject");
    setErr(null);
    try {
      await api.rejectSkillDraft(draft.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const tone = STATUS_TONE[draft.status];
  const pendingActions = draft.status === "draft";

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16, alignItems: "flex-start" }}>
        <div
          style={{ width: 6, alignSelf: "stretch", background: tone, borderRadius: 2, minHeight: 48 }}
        />
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 4 }}>
            <span
              className="mono"
              style={{
                fontSize: 10.5,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: tone,
              }}
            >
              {draft.status}
            </span>
            <span className="tiny mono" style={{ color: "var(--muted)" }}>
              {draft.proposed_slug}
            </span>
            <span className="tiny mono" style={{ color: "var(--muted)" }}>
              · {draft.agent_kind}
            </span>
            <span className="tiny mono" style={{ color: "var(--muted)" }}>
              · {relativeTime(draft.created_at)}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>{draft.title}</div>
          {draft.description && (
            <div className="small" style={{ color: "var(--ink-2)", maxWidth: 720 }}>
              {draft.description}
            </div>
          )}
          <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 8 }}>
            {draft.steps.length} step{draft.steps.length === 1 ? "" : "s"}
            {" · "}
            {draft.inferred_tools.length} tool{draft.inferred_tools.length === 1 ? "" : "s"}
            {draft.warnings.length > 0 && (
              <>
                {" · "}
                <span style={{ color: "var(--warn)" }}>
                  {draft.warnings.length} warning{draft.warnings.length === 1 ? "" : "s"}
                </span>
              </>
            )}
            {draft.llm_provider && ` · ${draft.llm_provider}/${draft.llm_model ?? "?"}`}
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8, padding: 0 }}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide details" : "Show details"}
          </button>

          {open && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
              {draft.warnings.length > 0 && (
                <div
                  style={{
                    padding: 10,
                    border: "1px solid var(--line)",
                    borderLeft: "2px solid var(--warn)",
                    borderRadius: "var(--radius)",
                    background: "var(--bg-1)",
                    fontSize: 12,
                    color: "var(--ink-2)",
                  }}
                >
                  <div className="mono" style={{ color: "var(--warn)", marginBottom: 6 }}>
                    {draft.warnings.length} WARNING{draft.warnings.length === 1 ? "" : "S"}
                  </div>
                  {draft.warnings.map((w, i) => <div key={i}>· {w}</div>)}
                </div>
              )}
              <div>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Steps</div>
                {draft.steps.length === 0 ? (
                  <div className="tiny" style={{ color: "var(--muted)" }}>(none)</div>
                ) : (
                  <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, lineHeight: 1.6 }}>
                    {draft.steps.map((s) => (
                      <li key={s.n}>
                        {s.instruction}
                        {s.tool && (
                          <span className="mono tiny" style={{ color: "var(--muted)", marginLeft: 8 }}>
                            ({s.tool})
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              {draft.inferred_tools.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Inferred tools</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {draft.inferred_tools.map((t) => (
                      <span key={t} className="pill solid">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {err && (
            <div
              style={{
                marginTop: 10,
                padding: 8,
                border: "1px solid var(--line)",
                borderLeft: "2px solid var(--neg)",
                borderRadius: "var(--radius)",
                background: "var(--bg-1)",
                fontSize: 12,
                color: "var(--ink-2)",
              }}
            >
              <span className="mono" style={{ color: "var(--neg)", marginRight: 6 }}>FAILED</span>
              {err}
            </div>
          )}
        </div>

        {pendingActions && (
          <div className="stack-v" style={{ alignItems: "flex-end", gap: 6 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onPromote}
              disabled={busy !== null}
            >
              {busy === "promote" ? "Promoting…" : "Promote"}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={onReject}
              disabled={busy !== null}
            >
              Reject
            </button>
          </div>
        )}
        {draft.status === "promoted" && draft.promoted_skill_id && (
          <div className="tiny mono" style={{ color: "var(--muted)" }}>
            ↳ skill {draft.promoted_skill_id.slice(0, 8)}
          </div>
        )}
      </div>
    </div>
  );
};

const SkillCard = ({ skill }: { skill: SkillRow }) => (
  <div className="card" style={{ padding: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
      <I name="zap" size={18} style={{ color: "var(--ink)" }} />
      <span className="pill">v{skill.version}</span>
    </div>
    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{skill.title}</div>
    <div className="tiny mono" style={{ color: "var(--muted)", marginBottom: 8 }}>
      {skill.slug}
    </div>
    {skill.description && (
      <div className="small" style={{ color: "var(--ink-2)", minHeight: 36 }}>
        {skill.description}
      </div>
    )}
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid var(--line)",
      }}
    >
      <span className="tiny mono">{skill.scope} · {skill.agent_kind}</span>
      {!skill.enabled && (
        <span className="pill" style={{ color: "var(--muted)" }}>disabled</span>
      )}
    </div>
  </div>
);

