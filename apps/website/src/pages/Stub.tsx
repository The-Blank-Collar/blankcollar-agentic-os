type StubProps = {
  eyebrow: string;
  title: string;
  body: string;
};

export function Stub({ eyebrow, title, body }: StubProps) {
  return (
    <div className="page">
      <div className="page-head">
        <div className="meta">
          <div className="editorial-eyebrow">{eyebrow}</div>
          <div className="titlerow">
            <div className="h1">{title}</div>
          </div>
          <div className="small" style={{ maxWidth: 620, marginTop: 4 }}>
            {body}
          </div>
        </div>
      </div>
      <div className="empty-hint" style={{ marginTop: 32 }}>
        Wires up in Sprint 2 — the API plumbing it depends on already exists.
      </div>
    </div>
  );
}
