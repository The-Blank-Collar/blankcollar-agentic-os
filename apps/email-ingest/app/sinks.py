"""HTTP sinks: gbrain (conversation memory) + paperclip (capture).

Every actionable inbound email lands as TWO rows:
  1. A `conversation` memory in gbrain — for recall.
  2. A `capture` in Paperclip — which the classifier resolves to a goal
     of the right kind (ephemeral / decision / standing / routine).

Non-actionable emails (announcements, FYIs) get only the memory.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger("email-ingest.sinks")


async def get_org_id(client: httpx.AsyncClient) -> str | None:
    """Resolve the configured org's UUID. Used to scope gbrain writes."""
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


async def create_capture(
    client: httpx.AsyncClient,
    *,
    raw_content: str,
    metadata: dict[str, Any],
) -> dict[str, Any] | None:
    """Posts to Paperclip's /api/capture endpoint with source=email.

    Paperclip classifies the content into a goal kind (ephemeral / decision /
    standing / routine), creates the goal, and persists the capture row.
    Returns { capture_id, goal_id, intent } on success.
    """
    body = {"raw_content": raw_content, "source": "email", "metadata": metadata}
    try:
        r = await client.post(
            f"{settings.paperclip_url}/api/capture", json=body, timeout=15.0
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.warning("paperclip capture failed: %s", e)
        return None
