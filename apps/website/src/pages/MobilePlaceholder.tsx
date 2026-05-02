export function MobilePlaceholder() {
  return (
    <div
      style={{
        textAlign: "center",
        maxWidth: 420,
        padding: "32px 24px",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-1)",
      }}
    >
      <div className="editorial-eyebrow" style={{ marginBottom: 16 }}>
        Mobile shell
      </div>
      <div className="h3" style={{ marginBottom: 12 }}>
        Coming soon.
      </div>
      <div className="small" style={{ color: "var(--ink-2)", lineHeight: 1.6 }}>
        The mobile companion is its own pairing session. Toggle back to
        <span className="mono"> Desktop </span>
        in the surface switch above to keep moving.
      </div>
    </div>
  );
}
