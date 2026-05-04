import type { CSSProperties, ReactNode } from "react";

type LoadingProps = { label?: string };
export function Loading({ label = "Loading…" }: LoadingProps) {
  return (
    <div className="empty-hint">{label}</div>
  );
}

type ErrorProps = { error: Error; onRetry?: () => void };
export function ErrorState({ error, onRetry }: ErrorProps) {
  return (
    <div
      style={{
        margin: "var(--pad-y) var(--pad-x)",
        padding: 18,
        border: "1px solid var(--line)",
        borderLeft: "2px solid var(--neg)",
        borderRadius: "var(--radius)",
        background: "var(--bg-1)",
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 6, color: "var(--neg)" }}>
        {friendlyTitle(error)}
      </div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 12 }}>
        {friendlyMessage(error)}
      </div>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

type EmptyProps = { title: string; hint?: string };
export function Empty({ title, hint }: EmptyProps) {
  return (
    <div
      style={{
        margin: "var(--pad-y) var(--pad-x)",
        padding: 32,
        border: "1px dashed var(--line)",
        borderRadius: "var(--radius-lg)",
        textAlign: "center",
        color: "var(--muted)",
      }}
    >
      <div className="serif" style={{ fontSize: 22, color: "var(--ink-2)", marginBottom: 6 }}>
        {title}
      </div>
      {hint && <div className="small">{hint}</div>}
    </div>
  );
}

/**
 * Compact inline error — used in cards / rails / tabs where the full
 * <ErrorState> would be visually heavy. Same friendly-message logic.
 */
type InlineErrorProps = {
  error: Error;
  onRetry?: () => void;
  style?: CSSProperties;
  /** Optional context label, e.g. "inbox" → "Couldn't load inbox". */
  context?: string;
};
export function InlineError({ error, onRetry, style, context }: InlineErrorProps) {
  return (
    <div
      style={{
        padding: "10px 12px",
        border: "1px solid var(--line)",
        borderLeft: "2px solid var(--neg)",
        borderRadius: "var(--radius)",
        background: "var(--bg-1)",
        fontSize: 12.5,
        color: "var(--ink-2)",
        display: "flex",
        gap: 10,
        alignItems: "center",
        ...style,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ color: "var(--neg)", fontWeight: 500, marginBottom: 2 }}>
          {context ? `Couldn't load ${context}` : friendlyTitle(error)}
        </div>
        <div>{friendlyMessage(error)}</div>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Friendly-message helpers. Map the most common API errors to copy that
 * a paying customer can act on; fall back to the raw text only when we
 * don't recognise the shape.
 */
export function friendlyTitle(error: Error | string): string {
  const m = (error instanceof Error ? error.message : error).toLowerCase();
  if (m.includes("auth_required") || m.includes("401")) return "Sign in to continue";
  if (m.includes("forbidden") || m.includes("403")) return "Not allowed";
  if (m.includes("payment_required") || m.includes("402") || m.includes("tier_cap")) {
    return "Plan limit reached";
  }
  if (m.includes("not_found") || m.includes("404")) return "Not found";
  if (m.includes("failed to fetch") || m.includes("network")) return "Connection lost";
  if (m.includes("rate") && m.includes("limit")) return "Slow down a sec";
  return "Couldn't load";
}

export function friendlyMessage(error: Error | string): string {
  const raw = error instanceof Error ? error.message : error;
  const m = raw.toLowerCase();
  if (m.includes("failed to fetch") || m.includes("networkerror")) {
    return "We can't reach the server. Check your connection — we'll retry on its own when you click below.";
  }
  if (m.includes("auth_required") || m.includes("401")) {
    return "Your session expired. Sign in again to keep going.";
  }
  if (m.includes("payment_required") || m.includes("402") || m.includes("tier_cap")) {
    return "Your plan doesn't include this. Upgrade in Settings → Billing.";
  }
  if (m.includes("not_found") || m.includes("404")) {
    return "That item doesn't exist any more. It may have been deleted or archived.";
  }
  // Strip common API-prefixes like "request failed (502): " for cleaner copy.
  return raw.replace(/^request failed \(\d+\):\s*/i, "");
}

/**
 * Tiny pill that callers can drop next to a section header to flag a
 * stale / failed query without taking up a whole card.
 */
export function ErrorBadge({ children }: { children: ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10.5,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--neg)",
        padding: "2px 6px",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
      }}
    >
      {children}
    </span>
  );
}
