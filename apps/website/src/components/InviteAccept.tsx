import { useEffect, useState } from "react";

import type { InvitationPublic } from "@blankcollar/shared";

import { I } from "../icons";
import { api } from "../lib/api";

/**
 * Invitation acceptance landing.
 *
 * Renders when the URL carries `?invite=<token>`. Looks the invitation up
 * via the public token endpoint, shows the org/role on offer, and lets
 * the recipient claim it. On success we strip the query param and refresh
 * whoami so the sidebar updates.
 */

type Props = {
  token: string;
  onClose: () => void;
};

type Stage = "loading" | "ready" | "expired" | "accepted" | "error";

export function InviteAccept({ token, onClose }: Props) {
  const [stage, setStage] = useState<Stage>("loading");
  const [invitation, setInvitation] = useState<InvitationPublic | null>(null);
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStage("loading");
    api
      .getInvitationByToken(token)
      .then((inv) => {
        if (cancelled) return;
        setInvitation(inv);
        if (inv.status === "pending") setStage("ready");
        else if (inv.status === "expired") setStage("expired");
        else setStage("error");
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setStage("error");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const accept = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.acceptInvitation(token, fullName.trim() ? { full_name: fullName.trim() } : {});
      setStage("accepted");
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
        style={{ width: 520 }}
        role="dialog"
        aria-label="Invitation"
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
          <I name="users" size={16} style={{ color: "var(--ink)" }} />
          <span className="eyebrow">You're invited</span>
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

        <div style={{ padding: 22 }}>
          {stage === "loading" && (
            <div className="empty-hint">Reading invitation…</div>
          )}

          {stage === "expired" && invitation && (
            <Block tone="warn" eyebrow="Expired">
              The invitation for <span className="mono">{invitation.email}</span> has expired.
              Ask the sender to issue a new one.
            </Block>
          )}

          {stage === "error" && (
            <Block tone="neg" eyebrow={invitation?.status ? invitation.status.toUpperCase() : "ERROR"}>
              {err ?? "This invitation isn't valid anymore."}
            </Block>
          )}

          {stage === "accepted" && invitation && (
            <Block tone="pos" eyebrow="You're in">
              You've joined{" "}
              <span style={{ fontWeight: 500 }}>
                {invitation.org.name ?? invitation.org.slug ?? "the org"}
              </span>{" "}
              as <span className="mono">{invitation.role}</span>
              {invitation.department && (
                <>
                  {" "}
                  in <span className="mono">{invitation.department.name ?? "—"}</span>
                </>
              )}
              .
              <div style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
                  Continue
                </button>
              </div>
            </Block>
          )}

          {stage === "ready" && invitation && (
            <>
              <div className="serif" style={{ fontSize: 22, fontWeight: 500, marginBottom: 6 }}>
                Join {invitation.org.name ?? invitation.org.slug ?? "the studio"}
              </div>
              <div className="small" style={{ color: "var(--ink-2)", marginBottom: 18 }}>
                You've been invited as <b>{invitation.role}</b>
                {invitation.department && (
                  <> on <b>{invitation.department.name}</b></>
                )}{" "}
                using <span className="mono">{invitation.email}</span>.
              </div>

              <input
                placeholder="Your name (optional)"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                style={{
                  width: "100%",
                  height: 38,
                  padding: "0 12px",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 14,
                  outline: "none",
                  marginBottom: 14,
                }}
                disabled={busy}
              />

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
                    marginBottom: 14,
                  }}
                >
                  <span className="mono" style={{ color: "var(--neg)", marginRight: 8 }}>
                    FAILED
                  </span>
                  {err}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={onClose}
                  disabled={busy}
                >
                  Not now
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={accept}
                  disabled={busy}
                >
                  {busy ? "Joining…" : "Accept invite"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Block({
  tone,
  eyebrow,
  children,
}: {
  tone: "pos" | "neg" | "warn";
  eyebrow: string;
  children: React.ReactNode;
}) {
  const color =
    tone === "pos" ? "var(--pos)"
    : tone === "neg" ? "var(--neg)"
    : "var(--warn)";
  return (
    <div
      style={{
        padding: 14,
        border: "1px solid var(--line)",
        borderLeft: `2px solid ${color}`,
        borderRadius: "var(--radius)",
        background: "var(--bg-1)",
        color: "var(--ink-2)",
        fontSize: 13.5,
        lineHeight: 1.55,
      }}
    >
      <div className="eyebrow" style={{ color, marginBottom: 6 }}>
        {eyebrow}
      </div>
      {children}
    </div>
  );
}
