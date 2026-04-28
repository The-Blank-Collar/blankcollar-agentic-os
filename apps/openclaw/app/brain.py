"""gbrain client — OpenClaw mostly writes documents from web fetches."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import settings
from app.models import Scope

log = logging.getLogger("openclaw.brain")


class BrainClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(base_url=settings.gbrain_url, timeout=15.0)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def remember(
        self,
        *,
        kind: str,
        title: str | None,
        content: str,
        scope: Scope,
        metadata: dict[str, Any] | None = None,
    ) -> str | None:
        body = {
            "kind": kind,
            "title": title,
            "content": content,
            "scope": _scope_payload(scope),
            "metadata": metadata or {},
        }
        try:
            r = await self._client.post("/remember", json=body)
            r.raise_for_status()
            return r.json().get("memory_id")
        except Exception as e:
            log.warning("gbrain remember failed: %s", e)
            return None


def _scope_payload(scope: Scope) -> dict[str, Any]:
    return {
        "org_id": str(scope.org_id),
        "department_id": str(scope.department_id) if scope.department_id else None,
        "goal_id": str(scope.goal_id) if scope.goal_id else None,
        "role": scope.role.value,
    }


brain = BrainClient()
