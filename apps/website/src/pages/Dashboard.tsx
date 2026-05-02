import { I, ChannelMark, Sigil } from "../icons";
import {
  goals,
  stats,
  heartbeats,
  teammates,
  you,
  brainNodes,
  brainEdges,
  type Goal,
  type Teammate,
} from "../data/fixtures";

const StatStrip = () => (
  <div className="stats">
    {stats.map((s) => (
      <div key={s.label} className="stat">
        <div className="label">{s.label}</div>
        <div className="v num">{s.value}</div>
        <div className={`delta ${s.deltaPos ? "pos" : "neg"}`}>
          {s.deltaPos ? "↑" : "↓"} {s.delta}
        </div>
      </div>
    ))}
  </div>
);

const Spark = ({ data, pos }: { data: number[]; pos: boolean }) => (
  <div className="spark">
    {data.map((v, i) => (
      <i
        key={i}
        style={{
          height: `${(v / 14) * 100}%`,
          background: pos ? "var(--ink-2)" : "var(--warn)",
          opacity: 0.4 + (i / data.length) * 0.6,
        }}
      />
    ))}
  </div>
);

const isHuman = (t: Teammate): t is Extract<Teammate, { human: true }> =>
  "human" in t && t.human === true;

const GoalRow = ({ g, onOpen }: { g: Goal; onOpen: (id: string) => void }) => {
  const ag: Teammate = teammates.find((t) => t.id === g.owner) || you;
  const statusColor = (
    {
      "on-track": "pos",
      "at-risk": "warn",
      done: "info",
      queued: "idle",
    } as Record<string, string>
  )[g.status] || "idle";
  return (
    <div className="goal-row" onClick={() => onOpen(g.id)}>
      <div className="gn">{g.id}</div>
      <div>
        <div className="gtitle">{g.title}</div>
        <div className="gsub">{g.sub}</div>
      </div>
      <div className="gprog">
        <div className="progressbar">
          <i style={{ width: `${g.progress}%` }} />
        </div>
        <span style={{ width: 28, textAlign: "right" }}>{g.progress}%</span>
      </div>
      <div className="gowner">
        {isHuman(ag) ? (
          <div className="avatar h" style={{ width: 22, height: 22, fontSize: 10 }}>
            {ag.initials}
          </div>
        ) : (
          <div className="sigil" style={{ width: 22, height: 22 }}>
            <Sigil seed={ag.seed} size={20} />
          </div>
        )}
        <span style={{ fontSize: 12 }}>{ag.name.split(" ")[0]}</span>
      </div>
      <div className="gdue">
        <span className={`dot ${statusColor}`} style={{ marginRight: 6 }} />
        {g.due}
      </div>
      <div className="gmore">
        <I name="chev" size={14} />
      </div>
    </div>
  );
};

const BrainMini = () => {
  const nodes = brainNodes.slice(0, 14);
  return (
    <svg viewBox="0 0 100 60" preserveAspectRatio="none" width="100%" height="100%">
      {brainEdges.slice(0, 18).map(([a, b], i) => {
        const na = brainNodes.find((n) => n.id === a);
        const nb = brainNodes.find((n) => n.id === b);
        if (!na || !nb) return null;
        return (
          <line
            key={i}
            x1={na.x}
            y1={na.y * 0.6}
            x2={nb.x}
            y2={nb.y * 0.6}
            stroke="var(--line-2)"
            strokeWidth="0.3"
          />
        );
      })}
      {nodes.map((n) => (
        <circle
          key={n.id}
          cx={n.x}
          cy={n.y * 0.6}
          r={n.size * 0.18}
          fill={
            n.kind === "person"
              ? "var(--ink)"
              : n.kind === "agent"
              ? "var(--ink-2)"
              : n.kind === "goal"
              ? "var(--bg)"
              : "var(--muted)"
          }
          stroke={n.kind === "goal" ? "var(--ink)" : "none"}
          strokeWidth="0.4"
        />
      ))}
    </svg>
  );
};

type Props = {
  onOpenGoal: (id: string) => void;
  onOpenBrain: () => void;
};

export function Dashboard({ onOpenGoal, onOpenBrain }: Props) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const liveGoals = goals.filter((g) => g.track === "active");
  const doneGoals = goals.filter((g) => g.track === "done");

  return (
    <div className="page">
      <div className="page-head">
        <div className="meta">
          <div className="editorial-eyebrow">№ 24 · Week of Jul 28</div>
          <div className="titlerow">
            <div className="h1">Good afternoon, Lior.</div>
          </div>
          <div className="small" style={{ maxWidth: 620, marginTop: 4 }}>
            Your studio is on pace for a record quarter. Two items want your attention today;
            everything else is moving without you.
          </div>
        </div>
        <div className="stack-h" style={{ alignItems: "center" }}>
          <span className="tiny mono">{today}</span>
          <span className="vrule" style={{ height: 28 }} />
          <button className="btn btn-sm">
            <I name="play" size={11} /> Daily briefing
          </button>
        </div>
      </div>

      <StatStrip />

      <div className="twocol">
        <div className="left">
          <div className="section">
            <div className="section-head">
              <div className="stack-h">
                <span className="title">Wants your attention</span>
                <span className="pill">2 items</span>
              </div>
              <div className="stack-h">
                <span className="tiny mono">Updated 1m ago</span>
              </div>
            </div>

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 16,
                  padding: "16px 18px",
                  alignItems: "center",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div className="sigil" style={{ width: 36, height: 36 }}>
                  <Sigil seed="Linden-rec-13" size={34} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    Linden wants approval to extend an offer{" "}
                    <span className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>
                      · Recruiting
                    </span>
                  </div>
                  <div className="small" style={{ marginTop: 4 }}>
                    Senior Designer, candidate <span className="mono">#C-019</span>. $148K base — 18% above band.
                    Reasoning: 9 of 9 interviewers ranked top-1. Two competing offers in market.
                  </div>
                </div>
                <div className="stack-h">
                  <button className="btn btn-sm">Decline</button>
                  <button className="btn btn-primary btn-sm">
                    <I name="check" size={12} /> Approve
                  </button>
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 16,
                  padding: "16px 18px",
                  alignItems: "center",
                }}
              >
                <div className="sigil" style={{ width: 36, height: 36 }}>
                  <Sigil seed="Quill-cpy-08" size={34} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    Quill drafted the Hadid Residence proposal — ready for your review
                    <span className="mono" style={{ color: "var(--muted)", fontSize: 11, marginLeft: 8 }}>
                      · $128,400 · 11 wk
                    </span>
                  </div>
                  <div className="small" style={{ marginTop: 4 }}>
                    Third revision incorporates your last note on phasing. Veda has client on a soft hold until Friday.
                  </div>
                </div>
                <div className="stack-h">
                  <button className="btn btn-sm">Open in sandbox</button>
                  <button className="btn btn-primary btn-sm">Review draft</button>
                </div>
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section-head">
              <div className="stack-h">
                <span className="title">Active goals</span>
                <span className="pill">{liveGoals.length}</span>
              </div>
              <div className="stack-h">
                <div className="seg">
                  <button className="on">Mine</button>
                  <button>Studio</button>
                  <button>All</button>
                </div>
                <button className="btn btn-ghost btn-sm">
                  <I name="filter" size={12} /> Filter
                </button>
                <button className="btn btn-ghost btn-sm">
                  <I name="sort" size={12} /> Sort
                </button>
              </div>
            </div>
            <div className="goal-list">
              {liveGoals.map((g) => (
                <GoalRow key={g.id} g={g} onOpen={onOpenGoal} />
              ))}
            </div>
          </div>

          <div className="section">
            <div className="section-head">
              <div className="stack-h">
                <span className="title">This week's outcomes</span>
                <span className="tiny mono">Mon 28 — Sun 03</span>
              </div>
              <button className="btn btn-ghost btn-sm">
                View all
                <I name="arrow" size={12} />
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 0,
                border: "1px solid var(--line)",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              {[
                { v: "+ $84K", l: "New revenue booked", sub: "2 contracts signed" },
                { v: "− $12.4K", l: "Costs avoided", sub: "Vendor renegotiations" },
                { v: "+ 5", l: "New leads qualified", sub: "From 23 raw inbound" },
              ].map((c, i) => (
                <div
                  key={i}
                  style={{
                    padding: 18,
                    borderRight: i < 2 ? "1px solid var(--line)" : 0,
                    background: "var(--bg-1)",
                  }}
                >
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    {c.l}
                  </div>
                  <div className="num" style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em" }}>
                    {c.v}
                  </div>
                  <div className="tiny" style={{ marginTop: 4 }}>
                    {c.sub}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="section">
            <div className="section-head">
              <div className="stack-h">
                <span className="title">Recently closed</span>
                <span className="pill">{doneGoals.length}</span>
              </div>
            </div>
            <div className="goal-list">
              {doneGoals.map((g) => (
                <GoalRow key={g.id} g={g} onOpen={onOpenGoal} />
              ))}
            </div>
          </div>
        </div>

        <div className="right">
          <div className="rail-section">
            <div className="section-head" style={{ marginBottom: 12 }}>
              <span className="title">Heartbeat</span>
              <span className="tiny mono">14d</span>
            </div>
            {heartbeats.map((h) => (
              <div key={h.kpi} className="hb-row">
                <div>
                  <div className="hbn">{h.kpi}</div>
                  <div className="hbsub">
                    {h.v} ·{" "}
                    <span style={{ color: h.pos ? "var(--pos)" : "var(--warn)" }}>{h.sub}</span>
                  </div>
                </div>
                <Spark data={h.trend} pos={h.pos} />
              </div>
            ))}
          </div>

          <div className="rail-section">
            <div className="section-head" style={{ marginBottom: 12 }}>
              <span className="title">Live now</span>
              <span className="live-tag">
                <span className="dot" />5
              </span>
            </div>
            {teammates
              .filter((t): t is Extract<Teammate, { status: "live" | "idle" | "warn" }> =>
                "status" in t && t.status === "live",
              )
              .slice(0, 5)
              .map((a) => (
                <div key={a.id} className="agent-item">
                  <div className="sigil">
                    <Sigil seed={a.seed} size={30} />
                  </div>
                  <div>
                    <div className="name">
                      {a.name}{" "}
                      <span className="role" style={{ marginLeft: 6 }}>
                        {a.role}
                      </span>
                    </div>
                    <div className="activity">{a.activity}</div>
                  </div>
                  <span className="dot live" />
                </div>
              ))}
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
            >
              Open team
            </button>
          </div>

          <div className="rail-section">
            <div className="section-head" style={{ marginBottom: 12 }}>
              <span className="title">Across your channels</span>
            </div>
            <div className="stack-v" style={{ gap: 10 }}>
              {[
                { ch: "slack", label: "Slack", note: "12 messages · 4 from clients", dot: "live" },
                { ch: "whatsapp", label: "WhatsApp", note: "4 unread · Aster handling", dot: "info" },
                { ch: "email", label: "Email", note: "8 in studio inbox · 2 need you", dot: "warn" },
                { ch: "telegram", label: "Telegram", note: "1 vendor reply", dot: "idle" },
              ].map((c) => (
                <div key={c.ch} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <ChannelMark ch={c.ch} size={20} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5 }}>{c.label}</div>
                    <div className="tiny">{c.note}</div>
                  </div>
                  <span className={`dot ${c.dot}`} />
                </div>
              ))}
            </div>
          </div>

          <div className="rail-section">
            <div className="section-head" style={{ marginBottom: 12 }}>
              <span className="title">Company brain</span>
              <button className="btn btn-ghost btn-sm" onClick={onOpenBrain}>
                Open
                <I name="arrow" size={12} />
              </button>
            </div>
            <div
              style={{
                height: 140,
                position: "relative",
                overflow: "hidden",
                border: "1px solid var(--line)",
                borderRadius: 4,
                background: "var(--bg)",
              }}
            >
              <BrainMini />
            </div>
            <div className="tiny" style={{ marginTop: 10 }}>
              <span className="num">2,418</span> facts · <span className="num">147</span> entities · last updated 2m ago
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
