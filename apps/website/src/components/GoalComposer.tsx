import { useEffect, useRef, useState } from "react";

import type { CaptureIntent, GoalKind } from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";

/**
 * Capture-first composer (Phase 4 polish #1).
 *
 * Single big "What's on your mind?" textarea. The classifier on the API
 * side reads the text and decides the goal's kind, target, due date,
 * cron schedule. The operator never has to pick — they just type the
 * thing they want done.
 *
 * Examples that all parse cleanly:
 *   "Remind me to call Mira on Friday"
 *      → ephemeral · due Fri
 *   "Every Monday at 9, generate the weekly digest"
 *      → routine · cron `0 9 * * 1`
 *   "Should I extend the offer to candidate C-019?"
 *      → decision
 *   "Grow the newsletter to 10k by end of Q3"
 *      → standing · target_value="10k" · auto-creates a KR
 *
 * After the API responds, we render a 1-line confirmation showing what
 * the system understood, then close the modal and route the operator to
 * the new goal's detail page.
 *
 * The "advanced" path (explicit kind picker) lives behind a toggle for
 * the rare case the operator wants to override the classifier.
 */

const KIND_LABEL: Record<GoalKind, string> = {
  ephemeral: "Ephemeral",
  standing:  "Standing",
  routine:   "Routine",
  decision:  "Decision",
};

const KIND_HINT: Record<GoalKind, string> = {
  ephemeral: "one-shot — runs once and closes",
  standing:  "ongoing — measured by KRs",
  routine:   "scheduled — fires on a cron",
  decision:  "needs your call — approve / decline",
};

const KINDS: GoalKind[] = ["ephemeral", "standing", "routine", "decision"];

const PLACEHOLDER_LINES = [
  "Remind me to call Mira on Friday",
  "Every Monday at 9, generate the weekly digest",
  "Should I extend the offer to candidate C-019?",
  "Grow the newsletter to 10k by end of Q3",
  "Reach $1.2M ARR by end of Q3",
  "Draft a polite follow-up to the Hadid email thread",
];

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (goalId: string) => void;
};

export function GoalComposer({ open, onClose, onCreated }: Props) {
  const [text, setText] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [forcedKind, setForcedKind] = useState<GoalKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [intent, setIntent] = useState<CaptureIntent | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const placeholder = useRef(PLACEHOLDER_LINES[Math.floor(Math.random() * PLACEHOLDER_LINES.length)]);

  useEffect(() => {
    if (!open) return;
    setText("");
    setShowAdvanced(false);
    setForcedKind(null);
    setBusy(false);
    setErr(null);
    setIntent(null);
    placeholder.current = PLACEHOLDER_LINES[Math.floor(Math.random() * PLACEHOLDER_LINES.length)];
    setTimeout(() => textRef.current?.focus(), 0);
  }, [open]);

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

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await api.createCapture({
        raw_content: text.trim(),
        source: "text",
        ...(forcedKind ? { kind: forcedKind } : {}),
      });
      setIntent(result.intent);
      // Brief celebration moment — show what was understood, then close.
      setTimeout(() => {
        onCreated?.(result.goal_id);
        onClose();
      }, 900);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (!open) return null;

  // Cmd/Ctrl+Enter submit shortcut on the textarea.
  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit(e as unknown as React.FormEvent);
    }
  };

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <form
        className="cmd"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ width: 600 }}
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
          <span className="eyebrow">What's on your mind?</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: "auto" }}
            onClick={onClose}
            aria-label="Close composer"
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder={placeholder.current}
            disabled={busy || !!intent}
            rows={4}
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
            maxLength={8000}
          />

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{
              alignSelf: "flex-start",
              padding: 0,
              fontSize: 11.5,
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "▾ Hide advanced" : "▸ Force a kind (optional)"}
          </button>

          {showAdvanced && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForcedKind(forcedKind === k ? null : k)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    border:
                      forcedKind === k
                        ? "1px solid var(--ink)"
                        : "1px solid var(--line)",
                    background: forcedKind === k ? "var(--bg-2)" : "var(--bg-1)",
                    color: "var(--ink)",
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{KIND_LABEL[k]}</div>
                  <div className="tiny" style={{ color: "var(--muted)", marginTop: 2 }}>
                    {KIND_HINT[k]}
                  </div>
                </button>
              ))}
            </div>
          )}

          {intent && (
            <div
              style={{
                padding: 14,
                border: "1px solid var(--line)",
                borderLeft: "2px solid var(--pos)",
                borderRadius: "var(--radius)",
                background: "var(--bg-1)",
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
                <span
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--pos)",
                  }}
                >
                  {KIND_LABEL[intent.kind]}
                </span>
                <span className="tiny mono" style={{ color: "var(--muted)" }}>
                  Got it.
                </span>
              </div>
              <div style={{ color: "var(--ink)", fontWeight: 500 }}>{intent.title}</div>
              <div className="tiny mono" style={{ color: "var(--muted)", marginTop: 6 }}>
                {[
                  intent.cron_expr ? `cron=${intent.cron_expr}` : null,
                  intent.due_at ? `due=${intent.due_at}` : null,
                  intent.target_value ? `target=${intent.target_value}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "no extras parsed"}
              </div>
            </div>
          )}

          {err && (
            <div
              style={{
                padding: 10,
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
        </div>

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
            <span className="kbd">esc</span> cancel · <span className="kbd">⌘</span>
            <span className="kbd">↵</span> capture
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={busy || !text.trim() || !!intent}
            >
              {busy && !intent ? "Capturing…" : intent ? "Got it" : "Capture"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
