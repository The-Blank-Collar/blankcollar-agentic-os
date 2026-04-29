"""Background runner — invokes the LangGraph workflow and stamps state."""

from __future__ import annotations

import asyncio
import logging

from app.dispatcher import get_compiled_graph
from app.models import RunRequest
from app.state import RunState, RunStatus, runs

log = logging.getLogger("langgraph.runner")


async def run(req: RunRequest) -> None:
    rid = str(req.run_id)
    state = runs[rid]

    try:
        if state.cancel_event.is_set():
            state.mark_cancelled()
            return

        subtask = req.input.get("subtask") or {}

        graph = get_compiled_graph()
        initial = {
            "goal_id": req.goal_id,
            "parent_run_id": req.run_id,
            "scope": req.scope,
            "subtask": subtask,
            "cycles": 0,
            "history": [],
        }

        # LangGraph's compiled graph supports ainvoke for a single end-to-end pass.
        result = await graph.ainvoke(initial)

        if state.cancel_event.is_set():
            state.mark_cancelled()
            return

        final = result.get("final") or {
            "agent_kind": "langgraph",
            "result": result.get("last_result"),
            "cycles": result.get("cycles", 0),
            "history": result.get("history", []),
        }

        # Mirror the underlying agent's status when there's exactly one step.
        last = (final.get("result") or {})
        if last.get("status") == "failed":
            state.mark_failed(last.get("error") or "downstream failed")
            return
        if last.get("status") == "cancelled":
            state.mark_cancelled()
            return

        state.mark_succeeded(final)
    except asyncio.CancelledError:
        state.mark_cancelled()
        raise
    except Exception as e:
        log.exception("langgraph dispatcher failed")
        state.mark_failed(str(e))


def schedule_run(req: RunRequest) -> RunState:
    state = RunState()
    runs[str(req.run_id)] = state
    state.task = asyncio.create_task(run(req))
    return state
