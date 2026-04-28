"""HTTP sinks: gbrain (memory) + paperclip (goal). Tiny, idempotent."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger("email-ingest.sinks")


async def get_org_id(client: httpx.AsyncClient) -> str | None:
    """Resolve the demo org's UUID via Paperclip's audit endpoint as a side
    effect (Paperclip resolves the same org on its side for every request).

    For now we hit /api/health then ask Paperclip to surface its scope via
    a goals listing; if any goal exists, we can derive org_id. To avoid
    that fragile path we use Paperclip's /api/orgs/by-slug endpoint added
    in the same commit.
    """
    try:
        r = await client.get(
            f"{settings.paperclip_url}/api/orgs/by-slug/{settings.org_slug}"
        )
        if r.status_code == 200:
            return r.json().get("id")
    except Exception as e:
        log.warning("org-id lookup failed: %s", e)
    return None


async def write_conversation_memory(
    client: httpx.AsyncClient,
    *,
    org_id: str,
    title: str,
    content: str,
    metadata: dict[str, Any],
) -> str | None:
    body = {
        "kind": "conversation",
        "title": title,
        "content": content,
        "scope": {"org_id": org_id, "role": "owner"},
        "metadata": metadata,
    }
    try:
        r = await client.post(f"{settings.gbrain_url}/remember", json=body, timeout=15.0)
        r.raise_for_status()
        return r.json().get("memory_id")
    except Exception as e:
        log.warning("gbrain remember failed: %s", e)
        return None


async def create_draft_goal(
    client: httpx.AsyncClient,
    *,
    title: str,
    description: str,
    metadata: dict[str, Any],
) -> str | None:
    body = {"title": title, "description": description, "metadata": metadata}
    try:
        r = await client.post(
            f"{settings.paperclip_url}/api/goals", json=body, timeout=15.0
        )
        r.raise_for_status()
        return r.json().get("id")
    except Exception as e:
        log.warning("paperclip goal create failed: %s", e)
        return None
