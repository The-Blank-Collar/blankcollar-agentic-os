/**
 * v0 plan generator.
 *
 * Produces a stub list of subtasks from a goal title + description.
 * Real planning lands when Phase 3 wires a reasoning agent into this slot.
 */

export type Subtask = {
  index: number;
  title: string;
  description: string;
  input: Record<string, unknown>;
};

export function generatePlan(input: {
  title: string;
  description?: string | null | undefined;
}): Subtask[] {
  const title = input.title.trim();
  const ctx = (input.description ?? "").trim();

  const subtasks: Omit<Subtask, "index">[] = [
    {
      title: "Understand the goal",
      description: `Read the goal "${title}" and any context. Capture key facts in the brain.`,
      input: { goal_title: title, goal_context: ctx, action: "ingest_context" },
    },
    {
      title: "Draft an approach",
      description: "Outline the steps the OS would take to achieve the goal.",
      input: { action: "outline_steps", goal_title: title },
    },
    {
      title: "Surface the first decision",
      description: "Identify the first decision a human needs to make. Write it as a memory.",
      input: { action: "first_decision", goal_title: title },
    },
  ];

  return subtasks.map((s, index) => ({ index, ...s }));
}
