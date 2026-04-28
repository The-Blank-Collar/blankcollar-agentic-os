/**
 * v0 plan generator.
 *
 * The Phase-3 upgrade: subtasks now carry `agent_kind`, and we recognise a
 * URL-bearing goal so the demo "summarise <url>" goes fetch → summarise →
 * decision-prompt automatically. Real LLM-driven planning lands in Phase 4.
 */

export type AgentKind = "hermes" | "openclaw";

export type Subtask = {
  index: number;
  title: string;
  description: string;
  agent_kind: AgentKind;
  input: Record<string, unknown>;
};

const URL_RE = /\bhttps?:\/\/[^\s)>\]"]+/i;

export function generatePlan(input: {
  title: string;
  description?: string | null | undefined;
}): Subtask[] {
  const title = input.title.trim();
  const ctx = (input.description ?? "").trim();

  const haystack = `${title}\n${ctx}`;
  const urlMatch = haystack.match(URL_RE);

  if (urlMatch) {
    const url = urlMatch[0];
    return numbered([
      {
        title: `Fetch ${shortenUrl(url)}`,
        description: "Politely fetch the page and store it as a document memory.",
        agent_kind: "openclaw",
        input: { skill: "web.fetch", url },
      },
      {
        title: "Summarise the page",
        description: "Read the fetched page from the brain and produce a concise summary.",
        agent_kind: "hermes",
        input: { action: "summarise_recent_document", source_url: url, target_length: "150 words" },
      },
      {
        title: "Surface the first decision",
        description: "Identify the first decision the human needs to make about this content.",
        agent_kind: "hermes",
        input: { action: "first_decision", goal_title: title },
      },
    ]);
  }

  // Generic fallback (same as Phase 2, now kind-tagged).
  return numbered([
    {
      title: "Understand the goal",
      description: `Read the goal "${title}" and any context. Capture key facts in the brain.`,
      agent_kind: "hermes",
      input: { action: "ingest_context", goal_title: title, goal_context: ctx },
    },
    {
      title: "Draft an approach",
      description: "Outline the steps the OS would take to achieve the goal.",
      agent_kind: "hermes",
      input: { action: "outline_steps", goal_title: title },
    },
    {
      title: "Surface the first decision",
      description: "Identify the first decision a human needs to make. Save as a memory.",
      agent_kind: "hermes",
      input: { action: "first_decision", goal_title: title },
    },
  ]);
}

function numbered(steps: Omit<Subtask, "index">[]): Subtask[] {
  return steps.map((s, index) => ({ index, ...s }));
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
}
