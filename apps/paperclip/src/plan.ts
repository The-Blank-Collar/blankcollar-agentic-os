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
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/i;
const SEARCH_TRIGGERS_RE = /\b(search|google|find|look\s+up|research|investigate)\b/i;
const EMAIL_TRIGGERS_RE = /\b(email|mail|send.*to|reply\s+to|write\s+to)\b/i;
const BROWSE_TRIGGERS_RE = /\b(browse|render|click|interact|spa|javascript|js-heavy|dashboard)\b/i;

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
    // If the goal also mentions JS-heavy / interactive cues, use the
    // Playwright-backed web.browse skill instead of the static web.fetch.
    const useBrowser = BROWSE_TRIGGERS_RE.test(haystack);
    const fetchSkill = useBrowser ? "web.browse" : "web.fetch";
    return numbered([
      {
        title: `${useBrowser ? "Browse" : "Fetch"} ${shortenUrl(url)}`,
        description: useBrowser
          ? "Render the page in headless Chromium and store the result as a document memory."
          : "Politely fetch the page and store it as a document memory.",
        agent_kind: "openclaw",
        input: { skill: fetchSkill, url },
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

  // Goal mentions an email address + an email-action verb → draft + send.
  const emailMatch = haystack.match(EMAIL_RE);
  if (emailMatch && EMAIL_TRIGGERS_RE.test(haystack)) {
    const to = emailMatch[0];
    return numbered([
      {
        title: "Draft the email",
        description: "Compose subject + body using the goal context and brain memories.",
        agent_kind: "hermes",
        input: { action: "draft_email", goal_title: title, to },
      },
      {
        title: `Send the email to ${to}`,
        description: "Send via the dedicated mailbox (or save as drafted if SMTP is unset).",
        agent_kind: "openclaw",
        input: {
          skill: "email.send",
          to,
          subject: title.slice(0, 200),
          body: ctx || `(see goal "${title}" — drafted automatically)`,
        },
      },
    ]);
  }

  // No URL — but if the goal sounds like a research / search task,
  // route through OpenClaw's web.search skill (Oxylabs / DDG).
  if (SEARCH_TRIGGERS_RE.test(haystack)) {
    const queryHint = title;
    return numbered([
      {
        title: "Search the web",
        description: "Run a web search relevant to the goal and store results as a document.",
        agent_kind: "openclaw",
        input: { skill: "web.search", query: queryHint, max_results: 10 },
      },
      {
        title: "Synthesise the findings",
        description: "Read the search results from the brain and produce a brief synthesis.",
        agent_kind: "hermes",
        input: { action: "synthesise_recent_document", goal_title: title },
      },
      {
        title: "Surface the first decision",
        description: "Identify the first decision the human needs to make from the findings.",
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
