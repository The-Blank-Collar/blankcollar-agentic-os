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
        Couldn't load
      </div>
      <div className="small" style={{ color: "var(--ink-2)", marginBottom: 12 }}>
        {error.message}
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
