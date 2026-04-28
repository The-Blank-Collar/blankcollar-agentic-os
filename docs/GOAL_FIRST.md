# Goal-First Philosophy

> The user manages **goals**. The OS manages **agents**.

## The core idea

Most agentic platforms today expose a developer-flavoured interface: spawn an agent, configure its prompt, attach tools, watch its terminal. That works for engineers. It does **not** work for the people Blank Collar is built for: business operators who want outcomes, not orchestration.

Blank Collar inverts the model. The primary noun in the system is the **goal**. Everything else — agents, tools, memory, runs — is plumbing the OS hides until you ask to look.

## The four levels of abstraction

| Level             | What you see                          | Who lives here                     |
|-------------------|---------------------------------------|------------------------------------|
| **Outcome**       | "Grow newsletter to 5,000 subscribers"| Owner, Department Lead             |
| **Plan**          | The OS-generated subtasks             | Department Lead (review/approve)   |
| **Run**           | Live telemetry of a single subtask    | Team Member, Auditor               |
| **Agent / Tool**  | Raw model, prompts, tool calls        | Engineer (debug only)              |

A "Dummies-mode" user never has to drop below **Outcome**.
A power user can drill all the way down to **Agent / Tool**.
The OS makes that drill-down progressive, never required.

## Goal lifecycle

```
draft  →  active  →  ┬─→ achieved
                     ├─→ paused
                     └─→ archived
```

Stored in `ops.goal.status` (see `infra/docker/postgres/init.sql`).

## What "Goal Command Centre" will feel like (Phase 4)

- A single dashboard pinned to **today's active goals**, grouped by department.
- Each goal card shows: progress, blockers, last activity, next decision needed from the human.
- Clicking a goal expands the plan; clicking a subtask shows the live run; clicking a run shows the agent — only if you ask.
- Creating a goal is a one-line conversation: "Increase trial-to-paid conversion by 15% this quarter." The OS proposes a plan; the human approves.

## What this means for engineering

Every new feature must answer: *does this surface a goal, or does it surface plumbing?*

- ✅ "Bulk-archive achieved goals" — surfaces goals.
- ✅ "Show which department spent the most last week" — surfaces outcomes.
- ⚠️ "Expose raw model temperature setting on the goal page" — surfaces plumbing; gate it behind an "advanced" panel.
- ❌ "Add a terminal where users can chat with an agent" — there's a place for that, but it's not the home screen.

This filter is the single most important design constraint in the project.
