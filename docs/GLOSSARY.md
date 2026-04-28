# Glossary

A single source of truth for terms used across docs, code, and UI. If a term you're tempted to use isn't here, add it here first.

## Core nouns

| Term              | Definition                                                                                          |
|-------------------|-----------------------------------------------------------------------------------------------------|
| **Agentic OS**    | The whole product: orchestrator + workforce + memory + storage, run as one system.                   |
| **Company**       | A user's instance of the OS. One company = one organization in the schema.                          |
| **Department**    | A logical grouping inside a company (Marketing, Sales, Support, …). Has its own goals and brain.     |
| **Goal**          | A user-defined outcome the OS is responsible for achieving. The primary unit of work.               |
| **Plan**          | The OS-generated breakdown of a Goal into subtasks. Reviewable by humans before execution.          |
| **Run**           | A single execution of a subtask by an agent. Has a status, input, output, and cost.                 |
| **Agent**         | A piece of software (Hermes, OpenClaw, …) that performs Runs. Hired into the company.               |
| **Skill**         | A capability an agent can invoke — web search, send email, query Postgres, etc. Lives in L2.        |
| **MCP Tool**      | A skill exposed via the Model Context Protocol. Skills can be local or MCP-backed.                  |
| **Role**          | One of `owner`, `department_lead`, `team_member`, `auditor`, `agent`. Controls what someone sees.   |
| **Scope**         | The tuple `(org, department?, goal?, role)` carried on every read/write.                            |
| **Memory**        | A unit stored in the Company Brain — fact, episode, document, or conversation.                      |
| **Company Brain** | gbrain + Qdrant + Postgres acting together as one persistent, role-scoped memory layer.             |
| **Audit log**     | The append-only record of every state mutation. `core.audit_log`.                                   |

## Component names

| Codename     | Plain meaning                                            | Folder                  |
|--------------|----------------------------------------------------------|-------------------------|
| **Paperclip** | Orchestrator + dashboard                                | `apps/paperclip`        |
| **Hermes**    | General-purpose workforce agent                         | `apps/hermes`           |
| **OpenClaw**  | Tool/browser-heavy agent                                | `apps/openclaw`         |
| **gbrain**    | Memory layer service                                    | `packages/gbrain`       |

## Status enums

### Goal status (`ops.goal_status`)

| Value      | Meaning                                                                           |
|------------|-----------------------------------------------------------------------------------|
| `draft`    | Created, not yet sent into execution.                                             |
| `active`   | The OS is working on it.                                                          |
| `paused`   | Temporarily stopped (cost limit, human review, etc.).                             |
| `achieved` | Success criteria met.                                                             |
| `archived` | Closed out. Read-only.                                                            |

### Run status (`ops.run_status`)

| Value       | Meaning                                                                          |
|-------------|----------------------------------------------------------------------------------|
| `queued`    | Created, waiting for a worker.                                                   |
| `running`   | An agent is currently executing.                                                 |
| `succeeded` | Completed cleanly.                                                               |
| `failed`    | Errored out.                                                                     |
| `cancelled` | Stopped by a human or by policy.                                                 |

### Memory kind (`brain.memory_kind`)

| Value          | Use for                                                                       |
|----------------|-------------------------------------------------------------------------------|
| `fact`         | Stable truths ("Our pricing is $29/mo").                                      |
| `episode`      | Things that happened ("Sales agent emailed 14 leads on April 12").            |
| `document`     | Embedded chunks of long-form content (PDFs, web pages, contracts).            |
| `conversation` | Dialogue history with humans or other agents.                                 |

## Phrases we use carefully

- **"Hire an agent"** — preferred over "spawn an agent" or "configure an agent." It frames the agent as a teammate, not a process.
- **"Fire an agent"** — yes, we go all the way. Agents can be fired. Their memories may be retained or wiped depending on policy.
- **"The brain"** — refers to *the company's* brain, not an individual agent's. Agents read *from* and write *to* the brain.
- **"Run a department"** — the OS runs a department; the human reviews it.

## Things we don't call something else

- **Job** — reserved for OS-internal queue items (background work). Not user-facing.
- **Task** — used inside a Plan. A user-facing word.
- **Workflow** — avoided. We say *Plan* instead. Workflows imply a frozen pipeline; Plans are alive.
