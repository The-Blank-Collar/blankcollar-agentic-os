/**
 * Fictional company state used while wiring screens to live API.
 * Retired one screen at a time as Sprint 2+ wires real data in.
 */

export type Human = {
  id: string;
  name: string;
  role: string;
  initials: string;
  human: true;
};
export type Agent = {
  id: string;
  name: string;
  role: string;
  seed: string;
  model: string;
  status: "live" | "idle" | "warn";
  activity: string;
  human?: false;
};
export type Teammate = Human | Agent;

export type Goal = {
  id: string;
  title: string;
  sub: string;
  progress: number;
  target: string;
  actual: string;
  delta: string;
  owner: string;
  deptId: string;
  due: string;
  status: "on-track" | "at-risk" | "done" | "queued";
  track: "active" | "done" | "queued";
  health?: string;
  contributors: string[];
  krs?: { id: string; title: string; done: number; total: number; by: string; note: string }[];
};

export type Stat = { label: string; value: string; delta: string; deltaPos: boolean };

export type ActivityEntry = {
  id: number;
  who: string;
  whoName: string;
  verb: string;
  obj: string;
  detail: string;
  when: string;
  channel: string;
  live?: boolean;
  action?: string;
  urgent?: boolean;
};

export type Heartbeat = { kpi: string; v: string; sub: string; trend: number[]; pos: boolean };

export type BrainNode = {
  id: string;
  label: string;
  kind: "person" | "agent" | "goal" | "project" | "doc" | "tool";
  x: number;
  y: number;
  size: number;
};

export const company = {
  name: "The Blank Collar",
  meta: "Studio · Est. 2025 · 4 humans, 11 agents",
  stage: "Series Seed",
};

export const you: Human = {
  id: "you",
  name: "Lior Avraham",
  role: "Founder",
  initials: "LA",
  human: true,
};

export const teammates: Teammate[] = [
  { id: "h1", name: "Mira Sokolov", role: "Head of Studio", initials: "MS", human: true },
  { id: "h2", name: "Daniel Park", role: "Operations", initials: "DP", human: true },
  { id: "a1", name: "Aster", role: "Marketing Lead", seed: "Aster-marketing-04", model: "claude-opus-4.5", status: "live", activity: "Drafting Q3 brand brief" },
  { id: "a2", name: "Veda", role: "Customer Success", seed: "Veda-cs-11", model: "claude-haiku-4.5", status: "live", activity: "Reviewing 3 inbound leads" },
  { id: "a3", name: "Orin", role: "Finance Analyst", seed: "Orin-fin-22", model: "claude-opus-4.5", status: "idle", activity: "Awaiting July ledger" },
  { id: "a4", name: "Mosaic", role: "Sourcing", seed: "Mosaic-src-09", model: "claude-haiku-4.5", status: "live", activity: "Pricing 14 vendors for Project Lark" },
  { id: "a5", name: "Halo", role: "PR & Press", seed: "Halo-pr-31", model: "claude-opus-4.5", status: "idle", activity: "Listening to AD inbox" },
  { id: "a6", name: "Linden", role: "Recruiting", seed: "Linden-rec-13", model: "claude-haiku-4.5", status: "warn", activity: "Approval needed: contractor intro" },
  { id: "a7", name: "Cobalt", role: "Project Manager", seed: "Cobalt-pm-07", model: "claude-opus-4.5", status: "live", activity: "Coordinating Lark install on Aug 14" },
  { id: "a8", name: "Plume", role: "Content & Social", seed: "Plume-soc-19", model: "claude-haiku-4.5", status: "idle", activity: "Queue: 5 posts scheduled" },
  { id: "a9", name: "Reed", role: "Legal Ops", seed: "Reed-lgl-02", model: "claude-opus-4.5", status: "idle", activity: "Reviewing supplier MSA" },
  { id: "a10", name: "Pixel", role: "Studio Photographer", seed: "Pixel-img-44", model: "claude-haiku-4.5", status: "idle", activity: "Editing Sycamore shoot" },
  { id: "a11", name: "Quill", role: "Copy & Proposals", seed: "Quill-cpy-08", model: "claude-opus-4.5", status: "live", activity: "Writing proposal for Hadid Residence" },
];

export const departments = [
  { id: "d1", name: "Studio", count: 5, lead: "h1", color: "var(--ink)" },
  { id: "d2", name: "Growth", count: 3, lead: "a1", color: "var(--info)" },
  { id: "d3", name: "Operations", count: 3, lead: "h2", color: "var(--warn)" },
  { id: "d4", name: "Finance & Legal", count: 2, lead: "a3", color: "var(--pos)" },
];

export const goals: Goal[] = [
  {
    id: "G-024",
    title: "Reach $1.2M ARR by end of Q3",
    sub: "Quarterly revenue goal · OKR 02 · Anchored to founder",
    progress: 68,
    target: "$1.20M",
    actual: "$816K",
    delta: "+12.4%",
    owner: "you",
    deptId: "d2",
    due: "Sep 30",
    status: "on-track",
    track: "active",
    health: "good",
    contributors: ["a1", "a2", "a11", "h1"],
    krs: [
      { id: "kr1", title: "Convert 8 active proposals to signed contracts", done: 5, total: 8, by: "a11", note: "Hadid + Sycamore expected this week" },
      { id: "kr2", title: "Maintain >32% gross margin across active projects", done: 31, total: 32, by: "a3", note: "Lark project running thin — Orin flagged for review" },
      { id: "kr3", title: "Reduce time-to-proposal from 11d to 4d", done: 6.2, total: 4, by: "a11", note: "Down from 8.4d two weeks ago" },
      { id: "kr4", title: "Launch referral program with 3 partner studios", done: 2, total: 3, by: "a1", note: "Awaiting Studio Werk countersign" },
    ],
  },
  {
    id: "G-025",
    title: "Cut sourcing turnaround time in half",
    sub: "Operations OKR · Owned by Cobalt",
    progress: 42, target: "From 9d → 4d", actual: "6.1d avg", delta: "-3.2d",
    owner: "a7", deptId: "d3", due: "Aug 22", status: "at-risk", track: "active",
    contributors: ["a4", "a7", "h2"],
  },
  {
    id: "G-026",
    title: "Open 3 new vendor accounts in Northeast region",
    sub: "Sourcing initiative · Owned by Mosaic",
    progress: 100, target: "3 accounts", actual: "3 of 3", delta: "complete",
    owner: "a4", deptId: "d3", due: "Jul 28", status: "done", track: "done",
    contributors: ["a4", "a7"],
  },
  {
    id: "G-027",
    title: "Publish 12 case-study editorials by Sept 1",
    sub: "Content goal · Owned by Plume",
    progress: 58, target: "12 essays", actual: "7 published", delta: "on track",
    owner: "a8", deptId: "d2", due: "Sep 1", status: "on-track", track: "active",
    contributors: ["a8", "a10", "a11"],
  },
  {
    id: "G-028",
    title: "Hire 1 Senior Designer (human) by end of August",
    sub: "Recruiting · Owned by Linden",
    progress: 30, target: "1 hire", actual: "9 candidates",
    delta: "needs founder review",
    owner: "a6", deptId: "d1", due: "Aug 30", status: "at-risk", track: "active",
    contributors: ["a6", "h1"],
  },
  {
    id: "G-029",
    title: "Refresh studio brand system",
    sub: "Brand · Owned by Aster",
    progress: 12, target: "Q4 launch", actual: "kickoff", delta: "queued",
    owner: "a1", deptId: "d2", due: "Nov 15", status: "queued", track: "queued",
    contributors: ["a1", "a8"],
  },
];

export const stats: Stat[] = [
  { label: "ARR (annualized)", value: "$816K", delta: "+12.4% vs last week", deltaPos: true },
  { label: "Active goals", value: "12", delta: "9 on track · 2 at risk", deltaPos: true },
  { label: "Agent hours this week", value: "412", delta: "vs 38 human hours", deltaPos: true },
  { label: "Cash runway", value: "21.4 mo", delta: "+0.7 mo since Jun", deltaPos: true },
];

export const activity: ActivityEntry[] = [
  { id: 1, who: "a4", whoName: "Mosaic", verb: "negotiated", obj: "vendor terms with Hutchings & Co.",
    detail: "Locked 14% net-30 discount. Saved est. $4,200 across Lark + Sycamore.",
    when: "2m ago", channel: "email", live: true },
  { id: 2, who: "a11", whoName: "Quill", verb: "drafted proposal v3", obj: "for Hadid Residence",
    detail: "Awaiting your review · $128,400 scope · 11 weeks.",
    when: "11m ago", channel: "sandbox", live: false, action: "Review" },
  { id: 3, who: "a2", whoName: "Veda", verb: "replied to", obj: "3 inbound leads on Slack #leads",
    detail: "1 hot, 2 nurture · scheduled follow-ups in Linear.",
    when: "24m ago", channel: "slack" },
  { id: 4, who: "h1", whoName: "Mira", verb: "approved", obj: "milestone payout for Project Lark",
    detail: "$22,000 released to vendors. Cobalt scheduled the wire.",
    when: "1h ago", channel: "stripe" },
  { id: 5, who: "a7", whoName: "Cobalt", verb: "rescheduled", obj: "Lark install kickoff",
    detail: "Moved Aug 14 → Aug 16 to align with site readiness. Notified all parties.",
    when: "1h ago", channel: "telegram" },
  { id: 6, who: "a6", whoName: "Linden", verb: "needs approval", obj: "to extend offer to candidate #C-019",
    detail: "Senior Designer · $148K base · 18% above band. Reasoning attached.",
    when: "3h ago", channel: "sys", action: "Decide", urgent: true },
  { id: 7, who: "a3", whoName: "Orin", verb: "flagged margin risk", obj: "on Project Lark",
    detail: "Gross margin trending to 28%, target 32%. Recommended scope adjustments attached.",
    when: "4h ago", channel: "sys", action: "Open" },
  { id: 8, who: "a1", whoName: "Aster", verb: "shipped", obj: "weekly newsletter to 4,210 subscribers",
    detail: "Open rate forecast 38% · A/B test on subject line ongoing.",
    when: "5h ago", channel: "email" },
  { id: 9, who: "a9", whoName: "Reed", verb: "redlined", obj: "Hutchings supplier MSA",
    detail: "12 changes proposed. Counterparty signed off on 9.",
    when: "yesterday", channel: "email" },
  { id: 10, who: "a8", whoName: "Plume", verb: "published", obj: "case study: \"The House on Elm\"",
    detail: "Live at blankcollar.studio/elm · Halo queued press push.",
    when: "yesterday", channel: "notion" },
];

export const heartbeats: Heartbeat[] = [
  { kpi: "Pipeline value", v: "$2.4M", sub: "+18% wk", trend: [3, 4, 5, 4, 6, 7, 8, 7, 9, 10, 9, 11, 12, 12], pos: true },
  { kpi: "Lead → proposal", v: "62%", sub: "+4 pts wk", trend: [4, 3, 4, 5, 5, 6, 7, 7, 6, 8, 9, 9, 10, 11], pos: true },
  { kpi: "Avg proposal $", v: "$94K", sub: "stable", trend: [6, 6, 7, 6, 7, 6, 7, 7, 7, 7, 8, 7, 7, 8], pos: true },
  { kpi: "Margin (active)", v: "31.4%", sub: "−0.6 pts wk", trend: [9, 9, 8, 8, 8, 7, 7, 7, 8, 7, 7, 7, 6, 7], pos: false },
];

export const brainNodes: BrainNode[] = [
  { id: "you", label: "Lior Avraham", kind: "person", x: 50, y: 48, size: 14 },
  { id: "h1", label: "Mira Sokolov", kind: "person", x: 36, y: 36, size: 9 },
  { id: "h2", label: "Daniel Park", kind: "person", x: 64, y: 60, size: 9 },
  { id: "a1", label: "Aster", kind: "agent", x: 26, y: 22, size: 9 },
  { id: "a4", label: "Mosaic", kind: "agent", x: 78, y: 30, size: 9 },
  { id: "a7", label: "Cobalt", kind: "agent", x: 70, y: 78, size: 9 },
  { id: "a11", label: "Quill", kind: "agent", x: 22, y: 70, size: 9 },
  { id: "a3", label: "Orin", kind: "agent", x: 88, y: 56, size: 8 },
  { id: "a2", label: "Veda", kind: "agent", x: 14, y: 50, size: 8 },
  { id: "G-024", label: "$1.2M ARR Q3", kind: "goal", x: 42, y: 16, size: 11 },
  { id: "G-025", label: "Sourcing -50%", kind: "goal", x: 80, y: 50, size: 9 },
  { id: "G-027", label: "12 case studies", kind: "goal", x: 58, y: 86, size: 9 },
  { id: "P-Lark", label: "Project Lark", kind: "project", x: 60, y: 32, size: 10 },
  { id: "P-Hadid", label: "Hadid Residence", kind: "project", x: 30, y: 56, size: 9 },
  { id: "P-Sycamore", label: "Sycamore", kind: "project", x: 50, y: 70, size: 8 },
  { id: "doc-brand", label: "Brand bible", kind: "doc", x: 8, y: 26, size: 7 },
  { id: "doc-msa", label: "Supplier MSA", kind: "doc", x: 92, y: 20, size: 7 },
  { id: "doc-okr", label: "Q3 OKR plan", kind: "doc", x: 18, y: 88, size: 7 },
  { id: "doc-case", label: "Elm case study", kind: "doc", x: 86, y: 86, size: 7 },
  { id: "mcp-stripe", label: "Stripe", kind: "tool", x: 92, y: 72, size: 7 },
  { id: "mcp-gmail", label: "Gmail", kind: "tool", x: 6, y: 68, size: 7 },
  { id: "mcp-linear", label: "Linear", kind: "tool", x: 74, y: 12, size: 7 },
];

export const brainEdges: [string, string][] = [
  ["you", "h1"], ["you", "h2"], ["you", "a1"], ["you", "a7"], ["you", "G-024"],
  ["a1", "G-024"], ["a11", "G-024"], ["a4", "G-025"], ["a8", "G-027"],
  ["G-024", "P-Hadid"], ["G-024", "P-Sycamore"],
  ["a7", "P-Lark"], ["a4", "P-Lark"], ["a11", "P-Hadid"], ["a4", "P-Sycamore"],
  ["P-Lark", "mcp-stripe"], ["P-Hadid", "mcp-stripe"],
  ["a2", "mcp-gmail"], ["a11", "mcp-gmail"],
  ["a7", "mcp-linear"], ["a4", "mcp-linear"],
  ["a1", "doc-brand"], ["a9", "doc-msa"], ["you", "doc-okr"], ["a8", "doc-case"],
  ["h1", "P-Lark"], ["h2", "mcp-stripe"],
];
