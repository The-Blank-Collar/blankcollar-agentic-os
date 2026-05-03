import { useEffect, useRef, useState } from "react";

import type { GoalKind } from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";

const KINDS: { value: GoalKind; label: string; hint: string }[] = [
  { value: "ephemeral", label: "Ephemeral", hint: "one-shot — runs once and closes" },
  { value: "standing",  label: "Standing",  hint: "ongoing — measured by KRs" },
  { value: "routine",   label: "Routine",   hint: "scheduled — fires on a cron" },
  { value: "decision",  label: "Decision",  hint: "needs your call — approve / decline" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called with the new goal's id after a successful create. */
  onCreated?: (goalId: string) => void;
};

export function GoalComposer({ open, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<GoalKind>("ephemeral");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  // Reset state + focus title every time we open.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setKind("ephemeral");
    setBusy(false);
    setErr(null);
    setTimeout(() => titleRef.current?.focus(), 0);
  }, [open]);

  // Close on Esc.
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
    if (busy || !title.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const goal = await api.createGoal({
        title: title.trim(),
        description: description.trim() || undefined,
        kind,
      });
      onCreated?.(goal.id);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <form
        className="cmd"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ width: 580 }}
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
          <I name="target" size={16} style={{ color: "var(--ink)" }} />
          <span className="eyebrow">New goal</span>
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
          <Field label="Title">
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. "Book 8 client demos by July 30"'
              style={inputStyle}
              maxLength={200}
            />
          </Field>

          <Field label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does success look like? Who's it for?"
              style={{ ...inputStyle, height: 90, resize: "vertical", padding: 10, lineHeight: 1.5 }}
              maxLength={5000}
            />
          </Field>

          <Field label="Kind">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    border:
                      kind === k.value
                        ? "1px solid var(--ink)"
                        : "1px solid var(--line)",
                    background: kind === k.value ? "var(--bg-2)" : "var(--bg-1)",
                    color: "var(--ink)",
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{k.label}</div>
                  <div className="tiny" style={{ color: "var(--muted)", marginTop: 2 }}>
                    {k.hint}
                  </div>
                </button>
              ))}
            </div>
          </Field>

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
            <span className="kbd">esc</span> to cancel · <span className="kbd">↵</span> to create
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={busy || !title.trim()}
            >
              {busy ? "Creating…" : "Create goal"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <span className="eyebrow">{label}</span>
    {children}
  </label>
);

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontFamily: "var(--font-sans)",
  fontSize: 13.5,
  outline: "none",
};
