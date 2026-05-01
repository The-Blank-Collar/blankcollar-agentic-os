/**
 * Onboarding question banks.
 *
 * Single-user mode: 7 questions, personal AIOS framing. Each answer feeds
 * the derived config (default agents to hire, suggested routines, brand
 * voice tone).
 *
 * Multi-user mode: 7 company-level questions answered by the founder,
 * followed by a 4-question individual interview every new teammate runs.
 *
 * The questions are intentionally short and dependency-free. The frontend
 * (eventually) walks them with the backend stateless beyond the
 * `ops.onboarding_profile` row that accumulates answers.
 */

export type Question = {
  id: string;
  prompt: string;
  hint?: string;
  optional?: boolean;
};

export const SINGLE_USER_QUESTIONS: Question[] = [
  {
    id: "Q1",
    prompt: "What's your name and what do you do?",
    hint: "One sentence — used to brand the assistant and tune the voice.",
  },
  {
    id: "Q2",
    prompt: "What's the one thing you'd love an assistant to handle for you, starting tomorrow?",
    hint: "The thing you keep dropping or putting off.",
  },
  {
    id: "Q3",
    prompt: "How do you usually receive work? (email, slack, calendar, voice memos…)",
    hint: "We'll wire up the right inbox channels.",
  },
  {
    id: "Q4",
    prompt: "What's a recurring thing you do every week that you wish ran on autopilot?",
    hint: "Becomes a routine — Monday digest, weekly review, etc.",
  },
  {
    id: "Q5",
    prompt: "What kinds of decisions should the assistant always queue for your approval, never act on alone?",
    hint: "Money, hiring, public-facing replies, anything else?",
  },
  {
    id: "Q6",
    prompt: "What's your morning briefing time, and how editorial do you want it (tight bullets vs paragraph)?",
  },
  {
    id: "Q7",
    prompt: "Describe your voice in three words — how you write, how the assistant should write for you.",
    hint: "Plain / warm / dry / precise / playful / blunt — pick three.",
  },
];

export const MULTI_USER_COMPANY_QUESTIONS: Question[] = [
  {
    id: "C1",
    prompt: "Company name + the one-sentence pitch.",
  },
  {
    id: "C2",
    prompt: "How is the company organised? (founders, departments, headcount)",
    hint: "We'll provision departments + role assignments.",
  },
  {
    id: "C3",
    prompt: "What recurring weekly outcomes does the company need? (newsletter, payroll, retro, etc.)",
    hint: "Becomes a starter set of routines per department.",
  },
  {
    id: "C4",
    prompt: "Where does external work arrive? (shared inboxes, Slack channels, support tickets)",
    hint: "We connect them via Nango.",
  },
  {
    id: "C5",
    prompt: "Spending governance: auto-approve under, manager-approve, founder-approve.",
    hint: "Three thresholds in dollars (or your currency).",
  },
  {
    id: "C6",
    prompt: "What's company-confidential vs shareable across all teammates?",
    hint: "Determines knowledge-doc default scope per department.",
  },
  {
    id: "C7",
    prompt: "Brand voice — how the company speaks externally. (Three words + a banned-words list.)",
  },
];

export const MULTI_USER_INDIVIDUAL_QUESTIONS: Question[] = [
  {
    id: "I1",
    prompt: "Your role + what you spend most of your week on.",
  },
  {
    id: "I2",
    prompt: "Which tools do you live in day-to-day?",
    hint: "We connect those first via Nango.",
  },
  {
    id: "I3",
    prompt: "What do you want the assistant to handle for you that your team doesn't need to see?",
    hint: "Becomes personal-scoped goals + skills.",
  },
  {
    id: "I4",
    prompt: "Do you want a personal daily briefing in addition to the company one?",
  },
];

export function questionsFor(mode: "single_user" | "multi_user", track?: "company" | "individual"): Question[] {
  if (mode === "single_user") return SINGLE_USER_QUESTIONS;
  if (track === "individual") return MULTI_USER_INDIVIDUAL_QUESTIONS;
  return MULTI_USER_COMPANY_QUESTIONS;
}
