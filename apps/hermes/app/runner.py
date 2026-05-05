"""The actual reasoning loop Hermes runs for each subtask."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app import brand as brand_loader
from app.brain import brain
from app.config import settings
from app.llm import LLM
from app.models import RunRequest
from app.state import RunState, RunStatus, runs

log = logging.getLogger("hermes.runner")

_BASE_SYSTEM_PROMPT = """You are Hermes, the general-purpose workforce agent of the Blank Collar Agentic OS.

You are calm, specific, and short. You produce concrete output that another agent
or a human can act on. Never use phrases like "let's", "exciting", or "as an AI".

You receive a goal context, recent memories from the company brain, and a single
subtask. Produce the result of executing that subtask. If the subtask is to
summarise content, summarise it. If it is to outline a plan, outline it. If it is
to draft a message, draft the message itself — not a meta-description.

Always end with one line:  "Decision needed:" — followed by the single most
important question for the human, or "none" if there is none."""


_BRAND = brand_loader.load(settings.brand_dir, settings.brand_name)
_BRAND_BLOCK = brand_loader.system_prompt_block(_BRAND)
SYSTEM_PROMPT = (
    f"{_BRAND_BLOCK}\n\n{_BASE_SYSTEM_PROMPT}" if _BRAND_BLOCK else _BASE_SYSTEM_PROMPT
)


async def run(req: RunRequest, llm: LLM) -> None:
    """Background coroutine for one /run. Updates `runs[run_id]` to terminal state."""
    rid = str(req.run_id)
    state = runs[rid]

    try:
        subtask = req.input.get("subtask") or {}
        title = subtask.get("title") or "(untitled subtask)"
        description = subtask.get("description") or ""
        sub_input: dict[str, Any] = subtask.get("input") or {}

        # 1. Pull recent context from the brain (scoped to org/dept/goal).
        if state.cancel_event.is_set():
            state.mark_cancelled()
            return
        memories = await brain.recall(
            query=f"context for: {title}. {description}",
            scope=req.scope,
            kinds=["fact", "episode", "document"],
        )
        memory_block = _format_memories(memories)

        if state.cancel_event.is_set():
            state.mark_cancelled()
            return

        # 2. Compose the user message and call the LLM.
        user_message = _format_task(
            title=title,
            description=description,
            sub_input=sub_input,
            memory_block=memory_block,
        )
        completion = await asyncio.wait_for(
            llm.complete(system=SYSTEM_PROMPT, user=user_message),
            timeout=120.0,
        )

        if state.cancel_event.is_set():
            state.mark_cancelled()
            return

        # 3. Persist an episode memory of what happened.
        memory_id = await brain.remember(
            kind="episode",
            title=f"Hermes: {title}",
            content=completion,
            scope=req.scope,
            metadata={
                "run_id": rid,
                "goal_id": str(req.goal_id),
                "subtask_index": subtask.get("index"),
                "source": "hermes",
                "model": llm.name,
            },
        )

        state.mark_succeeded(
            {
                "agent_kind": "hermes",
                "summary": completion,
                "memory_id": memory_id,
                "model": llm.name,
                "memories_used": len(memories),
            }
        )
    except asyncio.CancelledError:
        state.mark_cancelled()
        raise
    except Exception as e:
        log.exception("hermes run failed")
        state.mark_failed(str(e))


def _format_memories(memories: list[dict[str, Any]]) -> str:
    if not memories:
        return "(no relevant memories yet)"
    lines: list[str] = []
    for m in memories[:8]:
        title = m.get("title") or m.get("kind") or "memory"
        content = (m.get("content") or "").strip().splitlines()
        first = content[0] if content else ""
        if len(first) > 220:
            first = first[:220] + "…"
        lines.append(f"- ({m.get('kind')}) {title}: {first}")
    return "\n".join(lines)


def _format_task(
    *,
    title: str,
    description: str,
    sub_input: dict[str, Any],
    memory_block: str,
) -> str:
    # Phase 9.1 — pull the goal context out of sub_input (set by the
    # worker dispatcher when ops.goal_context has a row for this goal).
    # Promoted to its own block at the top of the user message so the
    # model treats it as standing instructions rather than per-call data.
    goal_context = sub_input.pop("goal_context", None)

    lines: list[str] = []
    if isinstance(goal_context, str) and goal_context.strip():
        lines.extend(
            [
                "Context for this goal (loaded from goal_context):",
                goal_context.strip(),
                "",
            ]
        )
    lines.extend(
        [
            f"Subtask: {title}",
            f"Description: {description}",
            "",
            "Recent company memories you may rely on:",
            memory_block,
            "",
            "Task input:",
        ]
    )
    for k, v in sub_input.items():
        if isinstance(v, str) and len(v) > 1500:
            v = v[:1500] + "…(truncated)"
        lines.append(f"  - {k}: {v}")
    return "\n".join(lines)


def schedule_run(req: RunRequest, llm: LLM) -> RunState:
    state = RunState()
    runs[str(req.run_id)] = state
    state.task = asyncio.create_task(run(req, llm))
    return state
