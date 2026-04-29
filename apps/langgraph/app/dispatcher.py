"""LangGraph workflow that orchestrates Hermes + OpenClaw.

The graph:

    classify ──► route ──► (hermes | openclaw | finish)
                              │           │
                              ▼           ▼
                         capture ◄────────┘
                              │
                       cycles < max?
                          │       │
                         yes      no
                          │       │
                          └► classify  finish

Loop termination is enforced by `cycles` in the graph state — never relies
on the model deciding it's done.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, TypedDict
from uuid import UUID

from langgraph.graph import END, StateGraph

from app.adapter_client import call_agent
from app.classifier import (
    Decision,
    classify_keywords,
    classify_with_llm,
    llm_provider,
)
from app.config import settings
from app.models import Scope

log = logging.getLogger("langgraph.dispatcher")


class DispatcherState(TypedDict, total=False):
    # Inputs (set once at the start)
    goal_id: UUID
    parent_run_id: UUID
    scope: Scope
    subtask: dict[str, Any]

    # Mutable per-cycle
    cycles: int
    decision: Decision
    last_result: dict[str, Any] | None
    history: Annotated[list[dict[str, Any]], lambda a, b: (a or []) + (b or [])]
    final: dict[str, Any] | None


# ---------- nodes ---------------------------------------------------------


async def classify_node(state: DispatcherState) -> dict[str, Any]:
    sub = state.get("subtask") or {}
    title = (sub.get("title") or "")[:200]
    description = (sub.get("description") or "")[:1000]
    sub_input = sub.get("input") or {}

    decision: Decision | None = await classify_with_llm(
        title=title, description=description, sub_input=sub_input
    )
    if decision is None:
        decision = classify_keywords(
            title=title, description=description, sub_input=sub_input
        )
    log.info("classifier → %s (cycle %d)", decision, state.get("cycles", 0))
    return {"decision": decision}


async def hermes_node(state: DispatcherState) -> dict[str, Any]:
    result = await call_agent(
        base_url=settings.hermes_url,
        goal_id=state["goal_id"],
        scope=state["scope"],
        subtask=state["subtask"],
        parent_run_id=state["parent_run_id"],
    )
    return {
        "last_result": result,
        "history": [{"agent": "hermes", **result}],
        "cycles": state.get("cycles", 0) + 1,
    }


async def openclaw_node(state: DispatcherState) -> dict[str, Any]:
    result = await call_agent(
        base_url=settings.openclaw_url,
        goal_id=state["goal_id"],
        scope=state["scope"],
        subtask=state["subtask"],
        parent_run_id=state["parent_run_id"],
    )
    return {
        "last_result": result,
        "history": [{"agent": "openclaw", **result}],
        "cycles": state.get("cycles", 0) + 1,
    }


async def finish_node(state: DispatcherState) -> dict[str, Any]:
    last = state.get("last_result")
    history = state.get("history") or []
    return {
        "final": {
            "agent_kind": "langgraph",
            "classifier_provider": llm_provider(),
            "cycles": state.get("cycles", 0),
            "history": history,
            "result": last,
        }
    }


# ---------- routing -------------------------------------------------------


def _route_after_classify(state: DispatcherState) -> str:
    if state.get("cycles", 0) >= settings.max_cycles:
        return "finish"
    decision = state.get("decision") or "hermes"
    return decision  # "hermes" | "openclaw" | "finish"


def _route_after_step(state: DispatcherState) -> str:
    """After a hermes/openclaw step, decide whether to loop back.

    For now: single pass. Multi-cycle loops are wired in the graph but
    we keep the default behaviour simple — one decision, one execution,
    finish. Multi-cycle is reachable by raising LANGGRAPH_MAX_CYCLES and
    returning the agent kind from the model in a future iteration.
    """
    return "finish"


# ---------- graph construction --------------------------------------------


def build_graph():
    graph = StateGraph(DispatcherState)
    graph.add_node("classify", classify_node)
    graph.add_node("hermes", hermes_node)
    graph.add_node("openclaw", openclaw_node)
    graph.add_node("finish", finish_node)

    graph.set_entry_point("classify")
    graph.add_conditional_edges(
        "classify",
        _route_after_classify,
        {"hermes": "hermes", "openclaw": "openclaw", "finish": "finish"},
    )
    graph.add_conditional_edges(
        "hermes",
        _route_after_step,
        {"classify": "classify", "finish": "finish"},
    )
    graph.add_conditional_edges(
        "openclaw",
        _route_after_step,
        {"classify": "classify", "finish": "finish"},
    )
    graph.add_edge("finish", END)
    return graph.compile()


_compiled = None


def get_compiled_graph():
    global _compiled
    if _compiled is None:
        _compiled = build_graph()
    return _compiled
