import { useEffect, useRef, useState } from "react";

import type {
  OnboardingDerived,
  OnboardingFinishResult,
  OnboardingQuestion,
  OnboardingStartResult,
} from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";

/**
 * Onboarding wizard (Phase 7).
 *
 * Walks the operator through the single-user question bank one prompt
 * at a time. Each answer posts to /api/onboarding/answer; the final
 * step calls /finish which materialises routine drafts + a voice doc.
 *
 * Designed as a soft greeter — the operator can dismiss at any time
 * and the next visit will offer to resume. The wizard's progress lives
 * in `ops.onboarding_profile`, so refreshing the page picks up exactly
 * where it was left.
 */

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called once the user finishes (or dismisses after finishing). */
  onCompleted?: (result: OnboardingFinishResult) => void;
};

type Stage = "loading" | "answering" | "finishing" | "done" | "error";

export function OnboardingWizard({ open, onClose, onCompleted }: Props) {
  const [stage, setStage] = useState<Stage>("loading");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<OnboardingQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [finishResult, setFinishResult] = useState<OnboardingFinishResult | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  // Boot — start (or resume) the profile.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStage("loading");
    setErr(null);
    setFinishResult(null);
    (async () => {
      try {
        const start: OnboardingStartResult = await api.onboardingStart({ mode: "single_user" });
        if (cancelled) return;
        setProfileId(start.profile_id);
        setQuestions(start.questions);
        setIndex(start.answered);
        setAnswer("");
        if (start.answered >= start.questions.length) {
          setStage("finishing");
          const result = await api.onboardingFinish(start.profile_id);
          if (cancelled) return;
          setFinishResult(result);
          setStage("done");
        } else {
          setStage("answering");
        }
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setStage("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Autofocus textarea on each new question.
  useEffect(() => {
    if (stage === "answering") {
      setTimeout(() => textRef.current?.focus(), 50);
    }
  }, [stage, index]);

  if (!open) return null;

  const currentQ: OnboardingQuestion | null = questions[index] ?? null;
  const isLast = index >= questions.length - 1;
  const total = questions.length;
  const progress = total > 0 ? Math.round((index / total) * 100) : 0;

  const submit = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault();
    if (busy || !currentQ) return;
    if (!currentQ.optional && !answer.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.onboardingAnswer(profileId!, {
        question_id: currentQ.id,
        answer: answer.trim(),
      });
      setAnswer("");
      if (isLast) {
        setStage("finishing");
        const result = await api.onboardingFinish(profileId!);
        setFinishResult(result);
        setStage("done");
      } else {
        setIndex((i) => i + 1);
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  const onTextareaKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  const skip = async (): Promise<void> => {
    if (!currentQ?.optional || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.onboardingAnswer(profileId!, { question_id: currentQ.id, answer: "" });
      setAnswer("");
      if (isLast) {
        setStage("finishing");
        const result = await api.onboardingFinish(profileId!);
        setFinishResult(result);
        setStage("done");
      } else {
        setIndex((i) => i + 1);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div
        className="cmd"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 640, maxHeight: "85vh", display: "flex", flexDirection: "column" }}
        role="dialog"
        aria-label="Onboarding"
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <I name="sparkle" size={16} style={{ color: "var(--ink)" }} />
          <span className="eyebrow">
            {stage === "done" ? "All set" : "Onboarding"}
          </span>
          {stage === "answering" && total > 0 && (
            <span className="tiny mono" style={{ color: "var(--muted)" }}>
              {index + 1} of {total}
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: "auto" }}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* progress bar */}
        {(stage === "answering" || stage === "finishing") && (
          <div
            style={{
              height: 2,
              background: "var(--line)",
              position: "relative",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                bottom: 0,
                width: `${stage === "finishing" ? 100 : progress}%`,
                background: "var(--ink-2)",
                transition: "width 0.18s ease",
              }}
            />
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {stage === "loading" && (
            <div className="empty-hint">Loading the interview…</div>
          )}

          {stage === "error" && (
            <div
              style={{
                padding: 14,
                border: "1px solid var(--line)",
                borderLeft: "2px solid var(--neg)",
                borderRadius: "var(--radius)",
                background: "var(--bg-1)",
              }}
            >
              <div className="eyebrow" style={{ color: "var(--neg)", marginBottom: 6 }}>
                Couldn't start onboarding
              </div>
              <div className="small">{err}</div>
            </div>
          )}

          {stage === "finishing" && (
            <div className="empty-hint">
              Wiring up routines + voice doc…
            </div>
          )}

          {stage === "answering" && currentQ && (
            <form onSubmit={submit}>
              <div
                className="serif"
                style={{
                  fontSize: 22,
                  fontWeight: 500,
                  lineHeight: 1.25,
                  letterSpacing: "-0.01em",
                  marginBottom: 10,
                }}
              >
                {currentQ.prompt}
              </div>
              {currentQ.hint && (
                <div className="small" style={{ color: "var(--ink-2)", marginBottom: 14 }}>
                  {currentQ.hint}
                </div>
              )}
              <textarea
                ref={textRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={onTextareaKey}
                placeholder="Type your answer…"
                rows={4}
                disabled={busy}
                style={{
                  width: "100%",
                  padding: 14,
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-lg)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 15,
                  lineHeight: 1.5,
                  resize: "vertical",
                  outline: "none",
                  minHeight: 100,
                }}
                maxLength={2000}
              />
              {err && (
                <div
                  style={{
                    marginTop: 10,
                    padding: 10,
                    border: "1px solid var(--line)",
                    borderLeft: "2px solid var(--neg)",
                    borderRadius: "var(--radius)",
                    background: "var(--bg-1)",
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                  }}
                >
                  {err}
                </div>
              )}
            </form>
          )}

          {stage === "done" && finishResult && (
            <DoneSummary result={finishResult} />
          )}
        </div>

        {stage === "answering" && currentQ && (
          <div
            style={{
              padding: "10px 14px",
              borderTop: "1px solid var(--line)",
              display: "flex",
              gap: 8,
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span className="tiny mono" style={{ color: "var(--muted)" }}>
              <span className="kbd">esc</span> save & close · <span className="kbd">⌘</span>
              <span className="kbd">↵</span> next
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {currentQ.optional && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={skip}
                  disabled={busy}
                >
                  Skip
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                onClick={onClose}
                disabled={busy}
              >
                Save & close
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => submit()}
                disabled={busy || (!currentQ.optional && !answer.trim())}
              >
                {busy ? "Saving…" : isLast ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        )}

        {stage === "done" && finishResult && (
          <div
            style={{
              padding: "10px 14px",
              borderTop: "1px solid var(--line)",
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                onCompleted?.(finishResult);
                onClose();
              }}
            >
              Open the dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DoneSummary({ result }: { result: OnboardingFinishResult }) {
  const d = result.derived as OnboardingDerived;
  return (
    <div>
      <div
        className="serif"
        style={{
          fontSize: 24,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          marginBottom: 10,
        }}
      >
        Your studio is set up.
      </div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 18 }}>
        I drafted{" "}
        <span className="num" style={{ fontWeight: 500, color: "var(--ink)" }}>
          {result.routines_created}
        </span>{" "}
        routine{result.routines_created === 1 ? "" : "s"} from your answers and saved your voice
        + governance preferences as a hot-context doc Hermes can recall in every reply.
      </div>

      <div
        style={{
          display: "grid",
          gap: 10,
        }}
      >
        {d.voice_words && d.voice_words.length > 0 && (
          <Tile label="Voice" value={d.voice_words.join(", ")} />
        )}
        {d.banned_words && d.banned_words.length > 0 && (
          <Tile label="Banned" value={d.banned_words.join(", ")} />
        )}
        {d.decision_categories && d.decision_categories.length > 0 && (
          <Tile
            label="Always asks you"
            value={d.decision_categories.join(" · ")}
          />
        )}
        {d.routine_hints && d.routine_hints.length > 0 && (
          <Tile label="Cadence cues" value={d.routine_hints.join(", ")} />
        )}
        {d.channels && d.channels.length > 0 && (
          <Tile label="Active channels" value={d.channels.join(", ")} />
        )}
        {d.briefing_hour_utc !== undefined && (
          <Tile label="Briefing hour (UTC)" value={String(d.briefing_hour_utc)} />
        )}
      </div>

      <div className="tiny" style={{ marginTop: 16, color: "var(--muted)" }}>
        You can rewrite any of this later in Settings → Voice & Governance.
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
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
      <div style={{ fontSize: 13.5, color: "var(--ink)" }}>{value}</div>
    </div>
  );
}
