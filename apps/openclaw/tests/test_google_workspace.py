"""Tests for the Google Workspace connector — argument shaping +
Nango call construction. We don't hit live Google or Nango; we monkeypatch
`nango_invoke` and verify the right endpoint/params/body get composed."""

from __future__ import annotations

from typing import Any

import pytest

from app.google_workspace import (
    GoogleError,
    calendar_create_event,
    docs_append,
    drive_search,
    gmail_search,
    sheets_append_row,
)


def _stub_nango(captured: list[dict[str, Any]], responses: list[dict[str, Any]]):
    """Returns an async stub that records each call and returns the next
    response from `responses`. Both lists are mutated as side-effects so
    tests can assert on what was sent."""

    async def fake(**kwargs: Any) -> dict[str, Any]:
        captured.append(kwargs)
        return responses.pop(0) if responses else {"ok": True, "body": {}, "status": 200}

    return fake


# ---------- gmail_search -------------------------------------------------


@pytest.mark.asyncio
async def test_gmail_search_lists_then_fetches_each(monkeypatch) -> None:
    captured: list[dict[str, Any]] = []
    responses: list[dict[str, Any]] = [
        # list response
        {
            "ok": True,
            "status": 200,
            "body": {"messages": [{"id": "m1"}, {"id": "m2"}]},
        },
        # detail responses
        {
            "ok": True,
            "status": 200,
            "body": {
                "id": "m1",
                "threadId": "t1",
                "snippet": "snippet1",
                "internalDate": "1714867200000",
                "payload": {
                    "headers": [
                        {"name": "From", "value": "alice@example.com"},
                        {"name": "Subject", "value": "Hello"},
                    ]
                },
            },
        },
        {
            "ok": True,
            "status": 200,
            "body": {
                "id": "m2",
                "threadId": "t2",
                "snippet": "snippet2",
                "internalDate": "1714953600000",
                "payload": {
                    "headers": [
                        {"name": "From", "value": "bob@example.com"},
                        {"name": "Subject", "value": "Hey"},
                    ]
                },
            },
        },
    ]

    from app import google_workspace as gw

    monkeypatch.setattr(gw, "nango_invoke", _stub_nango(captured, responses))

    result = await gmail_search(connection_id="conn-1", query="from:alice", max_results=2)

    assert result["result_count"] == 2
    assert result["threads"][0]["from"] == "alice@example.com"
    assert result["threads"][0]["subject"] == "Hello"
    assert result["threads"][0]["received_at"].endswith("+00:00")
    # First call lists, second + third fetch each message.
    assert captured[0]["endpoint"] == "/gmail/v1/users/me/messages"
    assert captured[0]["method"] == "GET"
    assert captured[0]["params"]["q"] == "from:alice"
    assert captured[1]["endpoint"] == "/gmail/v1/users/me/messages/m1"
    assert captured[2]["endpoint"] == "/gmail/v1/users/me/messages/m2"


@pytest.mark.asyncio
async def test_gmail_search_empty_query_rejected() -> None:
    with pytest.raises(GoogleError, match="non-empty query"):
        await gmail_search(connection_id="c", query="")


@pytest.mark.asyncio
async def test_gmail_search_caps_max_results(monkeypatch) -> None:
    captured: list[dict[str, Any]] = []
    responses: list[dict[str, Any]] = [{"ok": True, "status": 200, "body": {"messages": []}}]
    from app import google_workspace as gw

    monkeypatch.setattr(gw, "nango_invoke", _stub_nango(captured, responses))
    await gmail_search(connection_id="c", query="x", max_results=999)
    assert captured[0]["params"]["maxResults"] == 50


# ---------- calendar_create_event ----------------------------------------


@pytest.mark.asyncio
async def test_calendar_create_event_posts_correct_body(monkeypatch) -> None:
    captured: list[dict[str, Any]] = []
    responses = [
        {
            "ok": True,
            "status": 200,
            "body": {"id": "e1", "htmlLink": "https://calendar.google.com/x"},
        }
    ]
    from app import google_workspace as gw

    monkeypatch.setattr(gw, "nango_invoke", _stub_nango(captured, responses))

    result = await calendar_create_event(
        connection_id="c",
        summary="Team standup",
        start="2026-05-15T10:00:00Z",
        end="2026-05-15T10:30:00Z",
        description="Daily sync",
        attendees=["a@example.com", "b@example.com"],
    )

    assert result["id"] == "e1"
    assert captured[0]["endpoint"] == "/calendar/v3/calendars/primary/events"
    assert captured[0]["method"] == "POST"
    assert captured[0]["body"]["summary"] == "Team standup"
    assert captured[0]["body"]["attendees"] == [
        {"email": "a@example.com"},
        {"email": "b@example.com"},
    ]


@pytest.mark.asyncio
async def test_calendar_create_event_quotes_calendar_id(monkeypatch) -> None:
    captured: list[dict[str, Any]] = []
    responses = [{"ok": True, "status": 200, "body": {"id": "e", "htmlLink": "x"}}]
    from app import google_workspace as gw

    monkeypatch.setattr(gw, "nango_invoke", _stub_nango(captured, responses))
    await calendar_create_event(
        connection_id="c",
        summary="x",
        start="2026-05-15T10:00:00Z",
        end="2026-05-15T10:30:00Z",
        calendar_id="team@blankcollar.ai",
    )
    # The "@" must be URL-encoded so the path stays valid.
    assert "team%40blankcollar.ai" in captured[0]["endpoint"]


@pytest.mark.asyncio
async def test_calendar_create_event_requires_summary() -> None:
    with pytest.raises(GoogleError, match="summary"):
        await calendar_create_event(
            connection_id="c",
            summary="",
            start="2026-05-15T10:00:00Z",
            end="2026-05-15T10:30:00Z",
        )


# ---------- drive_search -------------------------------------------------


@pytest.mark.asyncio
async def test_drive_search_passes_field_mask(monkeypatch) -> None:
    captured: list[dict[str, Any]] = []
    responses = [
        {
            "ok": True,
            "status": 200,
            "body": {
                "files": [
                    {"id": "f1", "name": "Invoice.pdf", "mimeType": "application/pdf",
                     "modifiedTime": "2026-05-01T12:00:00Z", "webViewLink": "https://x"},
                ]
            },
        }
    ]
    from app import google_workspace as gw

    monkeypatch.setattr(gw, "nango_invoke", _stub_nango(captured, responses))
    result = await drive_search(connection_id="c", query="name contains 'Invoice'")

    assert result["result_count"] == 1
    assert result["files"][0]["name"] == "Invoice.pdf"
    assert captured[0]["endpoint"] == "/drive/v3/files"
    assert captured[0]["params"]["fields"].startswith("files(")


# ---------- docs_append --------------------------------------------------


@pytest.mark.asyncio
async def test_docs_append_uses_batch_update(monkeypatch) -> None:
    captured: list[dict[str, Any]] = []
    responses = [{"ok": True, "status": 200, "body": {}}]
    from app import google_workspace as gw

    monkeypatch.setattr(gw, "nango_invoke", _stub_nango(captured, responses))
    result = await docs_append(connection_id="c", document_id="doc-1", markdown="hello")

    assert result["document_id"] == "doc-1"
    # Adds a trailing newline if missing.
    assert result["appended_chars"] == len("hello\n")
    assert captured[0]["endpoint"] == "/docs/v1/documents/doc-1:batchUpdate"
    assert captured[0]["method"] == "POST"
    assert captured[0]["body"]["requests"][0]["insertText"]["text"] == "hello\n"


@pytest.mark.asyncio
async def test_docs_append_requires_doc_id() -> None:
    with pytest.raises(GoogleError, match="document_id"):
        await docs_append(connection_id="c", document_id="", markdown="x")


# ---------- sheets_append_row --------------------------------------------


@pytest.mark.asyncio
async def test_sheets_append_row_posts_values_and_user_entered(monkeypatch) -> None:
    captured: list[dict[str, Any]] = []
    responses = [
        {
            "ok": True,
            "status": 200,
            "body": {
                "updates": {
                    "updatedRange": "Sheet1!A2:C2",
                    "updatedRows": 1,
                    "updatedColumns": 3,
                }
            },
        }
    ]
    from app import google_workspace as gw

    monkeypatch.setattr(gw, "nango_invoke", _stub_nango(captured, responses))
    result = await sheets_append_row(
        connection_id="c",
        spreadsheet_id="ss-1",
        values=["alice@example.com", "subscribed", "2026-05-01"],
    )

    assert result["updated_range"] == "Sheet1!A2:C2"
    assert captured[0]["endpoint"].startswith("/sheets/v4/spreadsheets/ss-1/values/")
    assert captured[0]["params"]["valueInputOption"] == "USER_ENTERED"
    assert captured[0]["body"]["values"] == [
        ["alice@example.com", "subscribed", "2026-05-01"]
    ]


@pytest.mark.asyncio
async def test_sheets_append_row_requires_non_empty_values() -> None:
    with pytest.raises(GoogleError, match="values"):
        await sheets_append_row(connection_id="c", spreadsheet_id="ss", values=[])


# ---------- error propagation --------------------------------------------


@pytest.mark.asyncio
async def test_non_2xx_response_raises_google_error(monkeypatch) -> None:
    captured: list[dict[str, Any]] = []
    responses = [{"ok": False, "status": 401, "body": {"error": "unauthorized"}}]
    from app import google_workspace as gw

    monkeypatch.setattr(gw, "nango_invoke", _stub_nango(captured, responses))
    with pytest.raises(GoogleError, match="status=401"):
        await drive_search(connection_id="c", query="x")
