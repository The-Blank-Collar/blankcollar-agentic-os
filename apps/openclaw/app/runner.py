"""OpenClaw run loop. Reads `input.skill`, dispatches to the matching tool."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.brain import brain
from app.fetch import FetchError, web_fetch
from app.models import RunRequest
from app.state import RunState, RunStatus, runs

log = logging.getLogger("openclaw.runner")

SUPPORTED_SKILLS: tuple[str, ...] = ("web.fetch",)


async def run(req: RunRequest) -> None:
    rid = str(req.run_id)
    state = runs[rid]

    try:
        subtask = req.input.get("subtask") or {}
        sub_input: dict[str, Any] = subtask.get("input") or {}
        skill: str = (sub_input.get("skill") or "").strip()

        if state.cancel_event.is_set():
            state.mark_cancelled()
            return

        if not skill:
            # Default skill: if input has a `url`, treat as web.fetch.
            if "url" in sub_input:
                skill = "web.fetch"
            else:
                state.mark_failed(
                    f"no skill specified; supported: {', '.join(SUPPORTED_SKILLS)}"
                )
                return

        if skill not in SUPPORTED_SKILLS:
            state.mark_failed(
                f"unknown skill {skill!r}; supported: {', '.join(SUPPORTED_SKILLS)}"
            )
            return

        # ---- web.fetch ----
        if skill == "web.fetch":
            url = sub_input.get("url")
            if not isinstance(url, str) or not url:
                state.mark_failed("web.fetch requires `input.url`")
                return
            try:
                fetched = await asyncio.wait_for(web_fetch(url), timeout=20.0)
            except FetchError as fe:
                state.mark_failed(str(fe))
                return

            if state.cancel_event.is_set():
                state.mark_cancelled()
                return

            # Persist what we found as a `document` memory so Hermes can recall it.
            memory_id = await brain.remember(
                kind="document",
                title=fetched.get("title") or url,
                content=fetched.get("excerpt") or "",
                scope=req.scope,
                metadata={
                    "run_id": rid,
                    "goal_id": str(req.goal_id),
                    "skill": "web.fetch",
                    "url": url,
                    "final_url": fetched.get("final_url"),
                    "content_type": fetched.get("content_type"),
                    "content_length": fetched.get("content_length"),
                    "truncated": fetched.get("truncated"),
                    "source": "openclaw",
                },
            )

            state.mark_succeeded(
                {
                    "agent_kind": "openclaw",
                    "skill": "web.fetch",
                    "url": url,
                    "final_url": fetched.get("final_url"),
                    "title": fetched.get("title"),
                    "content_type": fetched.get("content_type"),
                    "content_length": fetched.get("content_length"),
                    "truncated": fetched.get("truncated"),
                    "memory_id": memory_id,
                    "excerpt_chars": len(fetched.get("excerpt") or ""),
                }
            )
            return

    except asyncio.CancelledError:
        state.mark_cancelled()
        raise
    except Exception as e:
        log.exception("openclaw run failed")
        state.mark_failed(str(e))


def schedule_run(req: RunRequest) -> RunState:
    state = RunState()
    runs[str(req.run_id)] = state
    state.task = asyncio.create_task(run(req))
    return state
