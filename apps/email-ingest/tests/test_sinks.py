"""Sink wrappers around gbrain + Paperclip /api/capture.

These tests exercise the request shape end-to-end against a respx-mocked
HTTP transport so we catch contract drift without a live stack.
"""

from __future__ import annotations

import httpx
import pytest

from app.config import settings
from app.sinks import create_capture, get_org_id, write_conversation_memory


@pytest.mark.asyncio
async def test_get_org_id_returns_uuid_on_200() -> None:
    transport = httpx.MockTransport(
        lambda req: httpx.Response(200, json={"id": "11111111-2222-3333-4444-555555555555"})
    )
    async with httpx.AsyncClient(transport=transport) as client:
        result = await get_org_id(client)
    assert result == "11111111-2222-3333-4444-555555555555"


@pytest.mark.asyncio
async def test_get_org_id_returns_none_on_failure() -> None:
    transport = httpx.MockTransport(lambda req: httpx.Response(404))
    async with httpx.AsyncClient(transport=transport) as client:
        result = await get_org_id(client)
    assert result is None


@pytest.mark.asyncio
async def test_write_conversation_memory_posts_correct_shape() -> None:
    captured: dict[str, object] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/remember"
        captured["body"] = req.read()
        return httpx.Response(201, json={"memory_id": "mem-1"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url=settings.gbrain_url) as client:
        result = await write_conversation_memory(
            client,
            org_id="org-1",
            title="Email from x",
            content="hello",
            metadata={"from": "x@y.com"},
        )
    assert result == "mem-1"
    body = captured["body"]
    assert b'"kind":"conversation"' in body
    assert b'"role":"owner"' in body
    assert b'"org_id":"org-1"' in body


@pytest.mark.asyncio
async def test_create_capture_posts_with_email_source() -> None:
    captured: dict[str, object] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.path == "/api/capture"
        captured["body"] = req.read()
        return httpx.Response(
            201,
            json={
                "capture_id": "cap-1",
                "goal_id": "goal-1",
                "intent": {"kind": "ephemeral", "title": "Reply to alice"},
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url=settings.paperclip_url) as client:
        result = await create_capture(
            client,
            raw_content="From: alice@example.com\nSubject: Re: proposal\n\nCan you reply?",
            metadata={"from": "alice@example.com", "subject": "Re: proposal"},
        )
    assert result is not None
    assert result["goal_id"] == "goal-1"
    assert result["intent"]["kind"] == "ephemeral"
    body = captured["body"]
    assert b'"source":"email"' in body
    assert b'"raw_content"' in body
