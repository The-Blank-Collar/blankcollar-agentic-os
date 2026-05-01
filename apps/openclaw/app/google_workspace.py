"""Google Workspace connectors — Gmail, Calendar, Drive, Docs, Sheets.

All calls go through self-hosted Nango (`Provider-Config-Key=google`).
This module is the typed Python mirror of `apps/paperclip/src/connectors/google.ts`,
moved here so the corresponding skills (google.gmail.search, …) actually
execute inside OpenClaw rather than proxying through Paperclip.

Mode-awareness: every function takes a `connection_id`. In single-user
mode that's the lone user's Google connection; in multi-user mode the
caller picks (skill input, manifest mapping, or per-agent default).
The skill handler in `runner.py` is responsible for resolving the right
connection_id before calling these.

Each function returns a typed dict on success or raises `GoogleError`.
"""

from __future__ import annotations

import logging
from typing import Any

from app.config import settings
from app.nango import NangoError, nango_invoke

log = logging.getLogger("openclaw.google")


class GoogleError(RuntimeError):
    pass


# ---------- Gmail ---------------------------------------------------------


async def gmail_search(
    *, connection_id: str, query: str, max_results: int = 10
) -> dict[str, Any]:
    """Searches the user's Gmail. Returns up to `max_results` thread summaries
    with sender, subject, snippet, internal date.

    Implementation: list message ids matching the query, then fetch each one
    with `format=metadata` so we don't pull bodies. Two round-trips per
    message; cap at the smallest `max_results` we can.
    """
    if not query:
        raise GoogleError("gmail_search requires a non-empty query")
    max_results = max(1, min(int(max_results), 50))

    list_call = await nango_invoke(
        provider_config_key=settings.nango_google_provider_key,
        connection_id=connection_id,
        endpoint="/gmail/v1/users/me/messages",
        method="GET",
        params={"q": query, "maxResults": max_results},
    )
    if not list_call.get("ok"):
        raise GoogleError(
            f"gmail list failed: status={list_call.get('status')} body={str(list_call.get('body'))[:200]}"
        )
    body = list_call.get("body") or {}
    messages: list[dict[str, Any]] = list(body.get("messages") or [])[:max_results]

    threads: list[dict[str, Any]] = []
    for m in messages:
        mid = m.get("id")
        if not isinstance(mid, str) or not mid:
            continue
        detail = await nango_invoke(
            provider_config_key=settings.nango_google_provider_key,
            connection_id=connection_id,
            endpoint=f"/gmail/v1/users/me/messages/{mid}",
            method="GET",
            params={"format": "metadata", "metadataHeaders": "From,Subject,Date"},
        )
        if not detail.get("ok"):
            continue
        d = detail.get("body") or {}
        headers = (((d.get("payload") or {}).get("headers")) or [])
        h_map = {h.get("name", "").lower(): h.get("value", "") for h in headers}
        threads.append(
            {
                "id": d.get("id"),
                "thread_id": d.get("threadId"),
                "from": h_map.get("from", ""),
                "subject": h_map.get("subject", ""),
                "snippet": d.get("snippet", ""),
                "received_at": _internal_date_to_iso(d.get("internalDate")),
            }
        )

    return {"threads": threads, "result_count": len(threads), "query": query}


def _internal_date_to_iso(internal_date: Any) -> str | None:
    """Gmail's internalDate is ms-since-epoch as a string."""
    try:
        from datetime import UTC, datetime
        if internal_date is None:
            return None
        ms = int(internal_date)
        return datetime.fromtimestamp(ms / 1000, tz=UTC).isoformat()
    except (TypeError, ValueError):
        return None


# ---------- Calendar ------------------------------------------------------


async def calendar_create_event(
    *,
    connection_id: str,
    summary: str,
    start: str,
    end: str,
    description: str | None = None,
    attendees: list[str] | None = None,
    calendar_id: str = "primary",
) -> dict[str, Any]:
    """Creates an event on the given calendar. Times must be ISO 8601 with
    a timezone (e.g. 2026-05-15T10:00:00-07:00 or 2026-05-15T10:00:00Z)."""
    if not summary:
        raise GoogleError("calendar_create_event requires a summary")
    if not start or not end:
        raise GoogleError("calendar_create_event requires start and end")

    # Google's API quotes the calendarId for the path.
    from urllib.parse import quote

    payload: dict[str, Any] = {
        "summary": summary,
        "start": {"dateTime": start},
        "end": {"dateTime": end},
    }
    if description:
        payload["description"] = description
    if attendees:
        payload["attendees"] = [{"email": e} for e in attendees if isinstance(e, str)]

    result = await nango_invoke(
        provider_config_key=settings.nango_google_provider_key,
        connection_id=connection_id,
        endpoint=f"/calendar/v3/calendars/{quote(calendar_id, safe='')}/events",
        method="POST",
        body=payload,
    )
    if not result.get("ok"):
        raise GoogleError(
            f"calendar create failed: status={result.get('status')} body={str(result.get('body'))[:200]}"
        )
    body = result.get("body") or {}
    return {
        "id": body.get("id"),
        "html_link": body.get("htmlLink"),
        "calendar_id": calendar_id,
        "summary": summary,
        "start": start,
        "end": end,
    }


# ---------- Drive ---------------------------------------------------------


async def drive_search(
    *, connection_id: str, query: str, max_results: int = 20
) -> dict[str, Any]:
    """Searches the user's Drive. Returns file metadata (no contents)."""
    if not query:
        raise GoogleError("drive_search requires a non-empty query")
    max_results = max(1, min(int(max_results), 100))

    result = await nango_invoke(
        provider_config_key=settings.nango_google_provider_key,
        connection_id=connection_id,
        endpoint="/drive/v3/files",
        method="GET",
        params={
            "q": query,
            "pageSize": max_results,
            "fields": "files(id,name,mimeType,modifiedTime,webViewLink)",
        },
    )
    if not result.get("ok"):
        raise GoogleError(
            f"drive search failed: status={result.get('status')} body={str(result.get('body'))[:200]}"
        )
    body = result.get("body") or {}
    files: list[dict[str, Any]] = list(body.get("files") or [])
    return {
        "files": files,
        "result_count": len(files),
        "query": query,
    }


# ---------- Docs ----------------------------------------------------------


async def docs_append(
    *, connection_id: str, document_id: str, markdown: str
) -> dict[str, Any]:
    """Appends `markdown` to the end of the doc. v0 inserts as plain text;
    a future iteration can do real markdown→Docs structure via batchUpdate."""
    if not document_id:
        raise GoogleError("docs_append requires a document_id")
    if not markdown:
        raise GoogleError("docs_append requires a non-empty markdown body")

    text = markdown if markdown.endswith("\n") else markdown + "\n"

    result = await nango_invoke(
        provider_config_key=settings.nango_google_provider_key,
        connection_id=connection_id,
        endpoint=f"/docs/v1/documents/{document_id}:batchUpdate",
        method="POST",
        body={
            "requests": [
                {
                    "insertText": {
                        "endOfSegmentLocation": {},
                        "text": text,
                    }
                }
            ]
        },
    )
    if not result.get("ok"):
        raise GoogleError(
            f"docs append failed: status={result.get('status')} body={str(result.get('body'))[:200]}"
        )
    return {"document_id": document_id, "appended_chars": len(text)}


# ---------- Sheets --------------------------------------------------------


async def sheets_append_row(
    *,
    connection_id: str,
    spreadsheet_id: str,
    values: list[str],
    range_a1: str = "Sheet1!A:Z",
) -> dict[str, Any]:
    """Appends a single row to the given range. Values are written
    USER_ENTERED so formulas + types resolve."""
    if not spreadsheet_id:
        raise GoogleError("sheets_append_row requires a spreadsheet_id")
    if not isinstance(values, list) or not values:
        raise GoogleError("sheets_append_row requires a non-empty values list")

    from urllib.parse import quote

    rng = quote(range_a1, safe="!:")
    result = await nango_invoke(
        provider_config_key=settings.nango_google_provider_key,
        connection_id=connection_id,
        endpoint=f"/sheets/v4/spreadsheets/{spreadsheet_id}/values/{rng}:append",
        method="POST",
        params={"valueInputOption": "USER_ENTERED"},
        body={"values": [values]},
    )
    if not result.get("ok"):
        raise GoogleError(
            f"sheets append failed: status={result.get('status')} body={str(result.get('body'))[:200]}"
        )
    body = result.get("body") or {}
    updates = body.get("updates") or {}
    return {
        "spreadsheet_id": spreadsheet_id,
        "range": range_a1,
        "updated_range": updates.get("updatedRange"),
        "updated_rows": updates.get("updatedRows"),
        "updated_columns": updates.get("updatedColumns"),
    }


# Re-export NangoError so callers can catch a single exception type if they
# don't care to distinguish transport from validation failures.
__all__ = [
    "GoogleError",
    "NangoError",
    "calendar_create_event",
    "docs_append",
    "drive_search",
    "gmail_search",
    "sheets_append_row",
]
