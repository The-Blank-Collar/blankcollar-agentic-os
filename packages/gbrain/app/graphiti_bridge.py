"""Best-effort bridge from gbrain /remember to graphiti /add.

Design rules:
  - NEVER raise. A graphiti outage must not break /remember.
  - Fire-and-forget: callers should kick this off as a background task.
  - When `GRAPHITI_URL` is empty, do nothing (silent disable).
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

import httpx

from app.config import settings

log = logging.getLogger("gbrain.graphiti_bridge")


async def push_to_graphiti(
    *,
    title: str | None,
    content: str,
    org_id: UUID,
    department_id: UUID | None,
    goal_id: UUID | None,
    role: str,
    metadata: dict[str, Any],
) -> None:
    """Best-effort POST to graphiti's /add. Swallows all errors.

    Returns nothing on purpose — callers fire-and-forget."""
    if not settings.graphiti_url:
        return

    body = {
        "name": (title or content[:80] or "memory")[:200],
        "body": content,
        "scope": {
            "org_id": str(org_id),
            "department_id": str(department_id) if department_id else None,
            "goal_id": str(goal_id) if goal_id else None,
            "role": role,
        },
        "source": "gbrain",
        "metadata": metadata or {},
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(f"{settings.graphiti_url}/add", json=body)
            if r.status_code >= 400:
                log.debug(
                    "graphiti /add returned %s: %s",
                    r.status_code,
                    (r.text or "")[:200],
                )
    except Exception as e:
        # Common in dev: graphiti not running, network blip, etc.
        log.debug("graphiti bridge skipped (%s)", e.__class__.__name__)
