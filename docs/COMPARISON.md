# How Blank Collar compares

Honest, opinionated map of where Blank Collar sits next to other tools you might be looking at. Updated as the landscape moves.

## The short version

> Most agent tools are **libraries for engineers**. Blank Collar is an **operating system for operators**. The library tools live *inside* our stack, not next to it.

## Side by side

| Dimension                    | Blank Collar                       | CrewAI / AutoGen / LangGraph          | n8n / Zapier (with AI nodes)        | ChatGPT/Claude (consumer)            |
|------------------------------|------------------------------------|---------------------------------------|-------------------------------------|--------------------------------------|
| Primary user                 | Operator / non-coder                | Engineer                              | No-code automator                   | Anyone with a prompt                 |
| Primary noun                 | **Goal**                           | Agent                                 | Workflow                            | Conversation                         |
| Multi-agent orchestration    | Yes (Paperclip)                    | Yes                                   | Limited                             | No (single agent)                    |
| Persistent, role-scoped memory | Yes (gbrain + Qdrant + Postgres) | DIY                                    | DIY                                 | Limited                              |
| Local-first by default       | Yes                                | Often                                 | Cloud-first                         | Cloud-only                           |
| Role-based access from day 1 | Yes                                | DIY                                   | Per-account                         | No                                   |
| Audit log                    | Built in                           | DIY                                   | Workflow-level                      | No                                   |
| Pluggable agents             | Yes (adapter contract)             | N/A (you build the agent)             | Limited                             | No                                   |
| Pluggable memory             | Yes                                | DIY                                   | DIY                                 | No                                   |
| Goal-first dashboard         | Yes (Phase 4)                      | No                                    | Workflow dashboard                  | No                                   |

## Where each tool wins, today

### CrewAI / AutoGen / LangGraph

If you're an engineer building a single bespoke multi-agent solution, these are excellent libraries. They give you fine-grained control over agent communication and tooling. Blank Collar can — and probably will — *use* them under the hood: a future Hermes adapter could be implemented on CrewAI without changing anything above L3.

**They beat us on:** programmer ergonomics, depth of agent-internal patterns.
**We beat them on:** persistent memory, role-scoping, audit, dashboard, beginner UX.

### n8n / Zapier with AI nodes

Beautiful for stitching together SaaS APIs with a sprinkle of model calls. They are not, however, a place to *run a company* — they're a place to run *a workflow*.

**They beat us on:** breadth of pre-built integrations.
**We beat them on:** memory, planning, multi-step reasoning, role enforcement.

### ChatGPT, Claude, etc. (consumer chat)

Phenomenal at one-shot help. Bad at "run my support inbox while I sleep." There's no orchestration, no scheduled work, no memory across sessions that you control.

**They beat us on:** raw model capability, polish.
**We beat them on:** "do work without me being there."

## Where Blank Collar deliberately doesn't compete

- **Foundation models.** We don't make models. We use them.
- **Vector databases.** We use Qdrant. We're not writing one.
- **General-purpose RPA.** We're not replacing Zapier; we're stacking on top of it where useful.
- **Bespoke developer agent IDEs.** Tools like Cursor and Claude Code are great at building software. We're not building a code editor.

## The bet, restated

Every other tool in the table treats the human as a **builder** of the agent system. Blank Collar treats the human as the **owner of a company** the system runs.

That single shift — owner, not builder — is the entire product.
