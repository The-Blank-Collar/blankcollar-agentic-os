import { useState } from "react";

import { useAuth } from "../lib/auth";

/**
 * Sign-in / sign-up surface. Rendered when auth is enabled and there's
 * no active Supabase session. Three sub-screens, toggled by `mode`:
 *
 *   - signin — email + password
 *   - signup — email + password + name
 *   - magic  — email-only magic link
 *
 * Editorial Swiss style — same tokens as the rest of the console so it
 * feels like part of the product, not a third-party login wall.
 */

type Mode = "signin" | "signup" | "magic" | "reset";

export function AuthGate() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      if (mode === "signin") {
        const { error } = await auth.signInWithPassword(email, password);
        if (error) setErr(friendly(error));
        // Successful sign-in flips the session; the App rerenders into the shell.
      } else if (mode === "signup") {
        const { error, needsEmailConfirm } = await auth.signUpWithPassword(email, password, fullName);
        if (error) setErr(friendly(error));
        else if (needsEmailConfirm) {
          setInfo("Check your email — we sent a confirmation link.");
        }
      } else if (mode === "magic") {
        const { error } = await auth.signInWithMagicLink(email);
        if (error) setErr(friendly(error));
        else setInfo("Sent. Click the link in your email to sign in.");
      } else if (mode === "reset") {
        const { error } = await auth.resetPassword(email);
        if (error) setErr(friendly(error));
        else setInfo("Sent. Check your email for a password-reset link.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg)",
        padding: 24,
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: "100%",
          background: "var(--bg-1)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-lg)",
          padding: 32,
        }}
      >
        <div className="brand" style={{ height: "auto", padding: 0, border: 0, marginBottom: 24 }}>
          <div className="brand-mark" />
          <div className="brand-name" style={{ fontSize: 18 }}>
            blankcollar<span>.ai</span>
          </div>
        </div>

        <div className="serif" style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em", marginBottom: 6 }}>
          {titleFor(mode)}
        </div>
        <div className="small" style={{ color: "var(--ink-2)", marginBottom: 24 }}>
          {subtitleFor(mode)}
        </div>

        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          {mode === "signup" && (
            <input
              autoFocus
              type="text"
              placeholder="Your name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              style={inputStyle}
            />
          )}
          <input
            autoFocus={mode !== "signup"}
            type="email"
            placeholder="email@yourdomain.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={inputStyle}
          />
          {(mode === "signin" || mode === "signup") && (
            <input
              type="password"
              placeholder={mode === "signup" ? "Pick a password (8+ chars)" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              style={inputStyle}
            />
          )}

          {err && (
            <div
              style={{
                padding: 10,
                border: "1px solid var(--line)",
                borderLeft: "2px solid var(--neg)",
                borderRadius: "var(--radius)",
                background: "var(--bg-2)",
                fontSize: 12.5,
                color: "var(--ink-2)",
              }}
            >
              {err}
            </div>
          )}
          {info && (
            <div
              style={{
                padding: 10,
                border: "1px solid var(--line)",
                borderLeft: "2px solid var(--pos)",
                borderRadius: "var(--radius)",
                background: "var(--bg-2)",
                fontSize: 12.5,
                color: "var(--ink-2)",
              }}
            >
              {info}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !email}
            style={{ height: 40 }}
          >
            {busy ? "…" : actionLabel(mode)}
          </button>
        </form>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 18,
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          {mode === "signin" && (
            <>
              <button type="button" className="btn-link" onClick={() => switchMode(setMode, setErr, setInfo, "signup")}>
                Create account
              </button>
              <button type="button" className="btn-link" onClick={() => switchMode(setMode, setErr, setInfo, "magic")}>
                Magic link
              </button>
              <button type="button" className="btn-link" onClick={() => switchMode(setMode, setErr, setInfo, "reset")}>
                Forgot password
              </button>
            </>
          )}
          {mode === "signup" && (
            <>
              <button type="button" className="btn-link" onClick={() => switchMode(setMode, setErr, setInfo, "signin")}>
                ← Sign in instead
              </button>
              <span />
            </>
          )}
          {mode === "magic" && (
            <>
              <button type="button" className="btn-link" onClick={() => switchMode(setMode, setErr, setInfo, "signin")}>
                ← Use password instead
              </button>
              <span />
            </>
          )}
          {mode === "reset" && (
            <>
              <button type="button" className="btn-link" onClick={() => switchMode(setMode, setErr, setInfo, "signin")}>
                ← Back to sign in
              </button>
              <span />
            </>
          )}
        </div>
      </div>

      <style>{`
        .btn-link {
          background: none;
          border: 0;
          color: var(--ink-2);
          font-family: inherit;
          font-size: 12px;
          text-decoration: underline;
          cursor: pointer;
          padding: 0;
        }
        .btn-link:hover { color: var(--ink); }
      `}</style>
    </div>
  );
}

function titleFor(mode: Mode): string {
  switch (mode) {
    case "signin": return "Sign in";
    case "signup": return "Create your studio";
    case "magic":  return "Magic link";
    case "reset":  return "Reset password";
  }
}

function subtitleFor(mode: Mode): string {
  switch (mode) {
    case "signin": return "Welcome back. Sign in to your studio.";
    case "signup": return "30 seconds to your own AI-native studio. Free to start.";
    case "magic":  return "We'll email you a one-tap sign-in link.";
    case "reset":  return "We'll email you a link to set a new password.";
  }
}

function actionLabel(mode: Mode): string {
  switch (mode) {
    case "signin": return "Sign in";
    case "signup": return "Create studio";
    case "magic":  return "Send magic link";
    case "reset":  return "Send reset link";
  }
}

function switchMode(
  setMode: (m: Mode) => void,
  setErr: (e: string | null) => void,
  setInfo: (i: string | null) => void,
  next: Mode,
): void {
  setMode(next);
  setErr(null);
  setInfo(null);
}

function friendly(raw: string): string {
  // Smooth a few common Supabase errors so users don't see API-ish text.
  const s = raw.toLowerCase();
  if (s.includes("invalid login")) return "Email or password is wrong. Try again, or use the magic link / reset.";
  if (s.includes("user already registered")) return "An account exists for that email — try signing in instead.";
  if (s.includes("password should be at least")) return "Pick a password with at least 8 characters.";
  if (s.includes("email not confirmed")) return "Check your email to confirm your account first.";
  return raw;
}

const inputStyle: React.CSSProperties = {
  height: 40,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius)",
  background: "var(--bg)",
  color: "var(--ink)",
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  outline: "none",
};
