"""HTTP client speaking the Agent Adapter Contract — used by the dispatcher
to call Hermes and OpenClaw. Mirrors the pattern in apps/paperclip/."""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import UUID, uuid4

import httpx

from app.config import settings
from app.models import Scope

log = logging.getLogger("langgraph.adapter")


def _scope_payload(scope: Scope, override_role: str | None = None) -> dict[str, Any]:
    return {
        "org_id": str(scope.org_id),
        "department_id": str(scope.department_id) if scope.department_id else None,
        "goal_id": str(scope.goal_id) if scope.goal_id else None,
        "role": override_role or scope.role.value,
    }


async def call_agent(
    *,
    base_url: str,
    goal_id: UUID,
    scope: Scope,
    subtask: dict[str, Any],
    parent_run_id: UUID,
) -> dict[str, Any]:
    """Dispatch a subtask to a downstream agent and wait for it to settle.

    Returns a dict with: status, output, error. Never raises — callers (the
    dispatcher graph nodes) get a structured failure they can branch on."""
    sub_run_id = str(uuid4())
    body = {
        "goal_id": str(goal_id),
        "run_id": sub_run_id,
        "input": {"subtask": subtask, "parent_run_id": str(parent_run_id)},
        "scope": _scope_payload(scope, override_role="agent"),
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            r = await client.post(f"{base_url}/run", json=body)
            r.raise_for_status()
        except Exception as e:
            return {
                "status": "failed",
                "output": None,
                "error": f"dispatch failed: {e.__class__.__name__}: {e}",
            }

        deadline = asyncio.get_event_loop().time() + settings.poll_downstream_timeout_s
        while True:
            await asyncio.sleep(settings.poll_downstream_interval_s)
            try:
                pr = await client.get(f"{base_url}/run/{sub_run_id}")
                pr.raise_for_status()
                data = pr.json()
            except Exception as e:
                log.warning("poll %s failed: %s", base_url, e)
                if asyncio.get_event_loop().time() > deadline:
                    return {"status": "failed", "output": None, "error": f"poll timeout: {e}"}
                continue

            status = data.get("status")
            if status in ("succeeded", "failed", "cancelled"):
                return {
                    "status": status,
                    "output": data.get("output"),
                    "error": data.get("error"),
                }

            if asyncio.get_event_loop().time() > deadline:
                return {"status": "failed", "output": None, "error": "downstream timeout"}


async def downstream_health(base_url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{base_url}/healthz")
            return r.status_code < 400
    except Exception:
        return False
