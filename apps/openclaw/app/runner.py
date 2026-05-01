"""OpenClaw run loop. Reads `input.skill`, dispatches to the matching tool."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app import brand as brand_loader
from app.brain import brain
from app.browser import BrowseError, web_browse
from app.config import settings
from app.email import EmailSendError, email_send
from app.fetch import FetchError, web_fetch
from app.google_workspace import (
    GoogleError,
    calendar_create_event,
    docs_append,
    drive_search,
    gmail_search,
    sheets_append_row,
)
from app.models import RunRequest
from app.nango import NangoError, nango_invoke
from app.search import SearchError, web_search
from app.state import RunState, RunStatus, runs

log = logging.getLogger("openclaw.runner")

_BRAND = brand_loader.load(settings.brand_dir, settings.brand_name)
_BRAND_BANNED: list[str] = list(_BRAND.get("banned") or [])  # type: ignore[arg-type]

SUPPORTED_SKILLS: tuple[str, ...] = (
    "web.fetch",
    "web.search",
    "email.send",
    "web.browse",
    "nango.invoke",
    # Google Workspace — all proxy through Nango with provider=google.
    "google.gmail.search",
    "google.calendar.create_event",
    "google.drive.search",
    "google.docs.append",
    "google.sheets.append_row",
)


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
            # Default skill: if input has a `url`, treat as web.fetch;
            # if it has a `query`, treat as web.search;
            # if it has a `to`, treat as email.send.
            if "url" in sub_input:
                skill = "web.fetch"
            elif "query" in sub_input:
                skill = "web.search"
            elif "to" in sub_input:
                skill = "email.send"
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

        # ---- web.search ----
        if skill == "web.search":
            query = sub_input.get("query")
            max_results = sub_input.get("max_results")
            if not isinstance(query, str) or not query:
                state.mark_failed("web.search requires `input.query`")
                return
            if max_results is not None and not isinstance(max_results, int):
                try:
                    max_results = int(max_results)  # be forgiving
                except (TypeError, ValueError):
                    state.mark_failed("web.search `max_results` must be an integer")
                    return

            try:
                result = await asyncio.wait_for(
                    web_search(query, max_results=max_results),
                    timeout=45.0,
                )
            except SearchError as se:
                state.mark_failed(str(se))
                return

            if state.cancel_event.is_set():
                state.mark_cancelled()
                return

            results = result.get("results") or []
            # Persist as a `document` memory so Hermes can reason on the SERP.
            content_lines = [f"Search results for: {query}", ""]
            for i, r in enumerate(results, 1):
                title = (r.get("title") or "(no title)")[:200]
                url = r.get("url") or ""
                snippet = (r.get("snippet") or "")[:400]
                content_lines.append(f"{i}. {title}\n   {url}\n   {snippet}")
            memory_id = await brain.remember(
                kind="document",
                title=f"Search: {query}",
                content="\n".join(content_lines),
                scope=req.scope,
                metadata={
                    "run_id": rid,
                    "goal_id": str(req.goal_id),
                    "skill": "web.search",
                    "provider": result.get("provider"),
                    "query": query,
                    "result_count": len(results),
                    "source": "openclaw",
                },
            )

            state.mark_succeeded(
                {
                    "agent_kind": "openclaw",
                    "skill": "web.search",
                    "provider": result.get("provider"),
                    "query": query,
                    "result_count": len(results),
                    "results": results[:5],  # echo top 5 in the run output for the dashboard
                    "memory_id": memory_id,
                }
            )
            return

        # ---- email.send ----
        if skill == "email.send":
            to = sub_input.get("to")
            subject = sub_input.get("subject") or ""
            body = sub_input.get("body") or ""
            cc_raw = sub_input.get("cc") or []
            cc: list[str] = [c for c in cc_raw if isinstance(c, str)]
            reply_to = sub_input.get("reply_to") if isinstance(sub_input.get("reply_to"), str) else None

            if not isinstance(to, str) or not to:
                state.mark_failed("email.send requires `input.to`")
                return
            if not isinstance(subject, str):
                subject = str(subject)
            if not isinstance(body, str):
                body = str(body)

            brand_hits = brand_loader.find_banned(f"{subject}\n{body}", _BRAND_BANNED)
            if brand_hits:
                log.info("email.send brand-lint flagged banned terms: %s", brand_hits)

            try:
                outcome = await email_send(
                    to=to,
                    subject=subject,
                    body=body,
                    cc=cc,
                    reply_to=reply_to,
                )
            except EmailSendError as ee:
                state.mark_failed(str(ee))
                return

            if state.cancel_event.is_set():
                state.mark_cancelled()
                return

            # Always record the message as a `conversation` memory so it
            # appears in audit + brain even when we couldn't actually deliver.
            memory_id = await brain.remember(
                kind="conversation",
                title=f"Email to {to}: {subject or '(no subject)'}",
                content=f"To: {to}\nSubject: {subject}\n\n{body}",
                scope=req.scope,
                metadata={
                    "run_id": rid,
                    "goal_id": str(req.goal_id),
                    "skill": "email.send",
                    "delivered": outcome.get("delivered"),
                    "status": outcome.get("status"),
                    "to": to,
                    "cc": cc,
                    "brand_lint": brand_hits,
                    "source": "openclaw",
                },
            )

            state.mark_succeeded(
                {
                    "agent_kind": "openclaw",
                    "skill": "email.send",
                    **outcome,
                    "brand_lint": brand_hits,
                    "memory_id": memory_id,
                }
            )
            return

        # ---- web.browse (Playwright + headless Chromium) ----
        if skill == "web.browse":
            url = sub_input.get("url")
            wait_until = sub_input.get("wait_until") or "networkidle"
            screenshot = bool(sub_input.get("screenshot", False))
            if not isinstance(url, str) or not url:
                state.mark_failed("web.browse requires `input.url`")
                return
            try:
                result = await asyncio.wait_for(
                    web_browse(url, wait_until=wait_until, screenshot=screenshot),
                    timeout=60.0,
                )
            except BrowseError as be:
                state.mark_failed(str(be))
                return

            if state.cancel_event.is_set():
                state.mark_cancelled()
                return

            # Persist as a `document` memory (excerpt only — screenshot stays
            # in the run output, not the brain, to keep gbrain payloads sane).
            memory_id = await brain.remember(
                kind="document",
                title=result.get("title") or url,
                content=result.get("excerpt") or "",
                scope=req.scope,
                metadata={
                    "run_id": rid,
                    "goal_id": str(req.goal_id),
                    "skill": "web.browse",
                    "url": url,
                    "final_url": result.get("final_url"),
                    "status": result.get("status"),
                    "viewport": result.get("viewport"),
                    "had_screenshot": result.get("screenshot_png_b64") is not None,
                    "source": "openclaw",
                },
            )

            state.mark_succeeded(
                {
                    "agent_kind": "openclaw",
                    "skill": "web.browse",
                    "url": url,
                    "final_url": result.get("final_url"),
                    "status": result.get("status"),
                    "title": result.get("title"),
                    "viewport": result.get("viewport"),
                    "screenshot_png_b64": result.get("screenshot_png_b64"),
                    "memory_id": memory_id,
                    "excerpt_chars": len(result.get("excerpt") or ""),
                }
            )
            return

        # ---- nango.invoke (proxy through Nango to a registered integration) ----
        if skill == "nango.invoke":
            provider = sub_input.get("provider_config_key") or sub_input.get("provider")
            connection = sub_input.get("connection_id") or sub_input.get("connection")
            endpoint = sub_input.get("endpoint")
            method = sub_input.get("method") or "GET"
            params = sub_input.get("params") or None
            headers = sub_input.get("headers") or None
            payload = sub_input.get("body")

            try:
                outcome = await asyncio.wait_for(
                    nango_invoke(
                        provider_config_key=str(provider) if provider else "",
                        connection_id=str(connection) if connection else "",
                        endpoint=str(endpoint) if endpoint else "",
                        method=str(method),
                        params=params if isinstance(params, dict) else None,
                        headers=headers if isinstance(headers, dict) else None,
                        body=payload,
                    ),
                    timeout=60.0,
                )
            except NangoError as ne:
                state.mark_failed(str(ne))
                return

            if state.cancel_event.is_set():
                state.mark_cancelled()
                return

            # Persist as a `conversation` memory — proxy calls are agent-to-system
            # interactions, not page-style content.
            preview = str(outcome.get("body"))[:2_000]
            memory_id = await brain.remember(
                kind="conversation",
                title=f"nango.{outcome['provider_config_key']} {outcome['method']} {outcome['endpoint']}"[:200],
                content=f"status: {outcome['status']}\n\n{preview}",
                scope=req.scope,
                metadata={
                    "run_id": rid,
                    "goal_id": str(req.goal_id),
                    "skill": "nango.invoke",
                    "provider_config_key": outcome["provider_config_key"],
                    "connection_id": outcome["connection_id"],
                    "endpoint": outcome["endpoint"],
                    "method": outcome["method"],
                    "status": outcome["status"],
                    "ok": outcome["ok"],
                    "source": "openclaw",
                },
            )

            state.mark_succeeded(
                {
                    "agent_kind": "openclaw",
                    "skill": "nango.invoke",
                    **outcome,
                    "memory_id": memory_id,
                }
            )
            return

        # ---- google.* (Workspace via Nango) -----------------------------
        if skill.startswith("google."):
            connection_id = sub_input.get("connection_id")
            if not isinstance(connection_id, str) or not connection_id:
                state.mark_failed(
                    f"{skill} requires `input.connection_id` (the Nango connection)"
                )
                return

            try:
                if skill == "google.gmail.search":
                    query = sub_input.get("query")
                    if not isinstance(query, str) or not query:
                        state.mark_failed("google.gmail.search requires `input.query`")
                        return
                    max_results = _coerce_int(sub_input.get("max_results"), 10)
                    result = await asyncio.wait_for(
                        gmail_search(
                            connection_id=connection_id,
                            query=query,
                            max_results=max_results,
                        ),
                        timeout=60.0,
                    )
                    title = f"Gmail search: {query}"[:200]
                    summary = (
                        f"Gmail search ({result['result_count']} threads) for: {query}\n\n"
                        + "\n".join(
                            f"- {t['from']} — {t['subject']}\n  {t['snippet'][:200]}"
                            for t in result["threads"]
                        )
                    )

                elif skill == "google.calendar.create_event":
                    summary_text = sub_input.get("summary")
                    start = sub_input.get("start")
                    end = sub_input.get("end")
                    if not isinstance(summary_text, str) or not summary_text:
                        state.mark_failed("google.calendar.create_event requires `input.summary`")
                        return
                    if not isinstance(start, str) or not isinstance(end, str):
                        state.mark_failed(
                            "google.calendar.create_event requires `input.start` and `input.end` ISO strings"
                        )
                        return
                    description = sub_input.get("description")
                    description = description if isinstance(description, str) else None
                    attendees_raw = sub_input.get("attendees") or []
                    attendees = [a for a in attendees_raw if isinstance(a, str)]
                    calendar_id = sub_input.get("calendar_id") or "primary"
                    if not isinstance(calendar_id, str):
                        calendar_id = "primary"
                    result = await asyncio.wait_for(
                        calendar_create_event(
                            connection_id=connection_id,
                            summary=summary_text,
                            start=start,
                            end=end,
                            description=description,
                            attendees=attendees,
                            calendar_id=calendar_id,
                        ),
                        timeout=60.0,
                    )
                    title = f"Calendar: {summary_text}"[:200]
                    summary = (
                        f"Created calendar event '{summary_text}'\n"
                        f"Calendar: {calendar_id}\n"
                        f"Start: {start}\nEnd: {end}\n"
                        f"Attendees: {', '.join(attendees) if attendees else '(none)'}\n"
                        f"Link: {result.get('html_link') or '(none)'}"
                    )

                elif skill == "google.drive.search":
                    query = sub_input.get("query")
                    if not isinstance(query, str) or not query:
                        state.mark_failed("google.drive.search requires `input.query`")
                        return
                    max_results = _coerce_int(sub_input.get("max_results"), 20)
                    result = await asyncio.wait_for(
                        drive_search(
                            connection_id=connection_id,
                            query=query,
                            max_results=max_results,
                        ),
                        timeout=60.0,
                    )
                    title = f"Drive search: {query}"[:200]
                    summary = (
                        f"Drive search ({result['result_count']} files) for: {query}\n\n"
                        + "\n".join(
                            f"- {f.get('name')} ({f.get('mimeType')}) — {f.get('webViewLink')}"
                            for f in result["files"][:20]
                        )
                    )

                elif skill == "google.docs.append":
                    document_id = sub_input.get("document_id")
                    markdown = sub_input.get("markdown")
                    if not isinstance(document_id, str) or not document_id:
                        state.mark_failed("google.docs.append requires `input.document_id`")
                        return
                    if not isinstance(markdown, str) or not markdown:
                        state.mark_failed("google.docs.append requires `input.markdown`")
                        return
                    result = await asyncio.wait_for(
                        docs_append(
                            connection_id=connection_id,
                            document_id=document_id,
                            markdown=markdown,
                        ),
                        timeout=60.0,
                    )
                    title = f"Doc append: {document_id}"[:200]
                    summary = (
                        f"Appended {result['appended_chars']} chars to "
                        f"Google Doc {document_id}"
                    )

                elif skill == "google.sheets.append_row":
                    spreadsheet_id = sub_input.get("spreadsheet_id")
                    raw_values = sub_input.get("values")
                    if not isinstance(spreadsheet_id, str) or not spreadsheet_id:
                        state.mark_failed("google.sheets.append_row requires `input.spreadsheet_id`")
                        return
                    if not isinstance(raw_values, list) or not raw_values:
                        state.mark_failed("google.sheets.append_row requires non-empty `input.values`")
                        return
                    values = [str(v) for v in raw_values]
                    range_a1 = sub_input.get("range") or "Sheet1!A:Z"
                    if not isinstance(range_a1, str):
                        range_a1 = "Sheet1!A:Z"
                    result = await asyncio.wait_for(
                        sheets_append_row(
                            connection_id=connection_id,
                            spreadsheet_id=spreadsheet_id,
                            values=values,
                            range_a1=range_a1,
                        ),
                        timeout=60.0,
                    )
                    title = f"Sheet append: {spreadsheet_id}"[:200]
                    summary = (
                        f"Appended row {values} to Sheet {spreadsheet_id} "
                        f"(updated_range={result.get('updated_range')})"
                    )

                else:
                    state.mark_failed(
                        f"unknown google skill {skill!r}; supported: "
                        "google.gmail.search, google.calendar.create_event, "
                        "google.drive.search, google.docs.append, google.sheets.append_row"
                    )
                    return

            except (GoogleError, NangoError) as ge:
                state.mark_failed(str(ge))
                return

            if state.cancel_event.is_set():
                state.mark_cancelled()
                return

            # Persist as conversation memory — these are agent-to-system
            # interactions, not page-style content. Hermes can recall the
            # outcome on the next run.
            memory_id = await brain.remember(
                kind="conversation",
                title=title,
                content=summary,
                scope=req.scope,
                metadata={
                    "run_id": rid,
                    "goal_id": str(req.goal_id),
                    "skill": skill,
                    "connection_id": connection_id,
                    "source": "openclaw",
                },
            )

            state.mark_succeeded(
                {
                    "agent_kind": "openclaw",
                    "skill": skill,
                    "connection_id": connection_id,
                    **result,
                    "memory_id": memory_id,
                }
            )
            return

    except asyncio.CancelledError:
        state.mark_cancelled()
        raise
    except Exception as e:
        log.exception("openclaw run failed")
        state.mark_failed(str(e))


def _coerce_int(value: Any, default: int) -> int:
    if isinstance(value, int):
        return value
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def schedule_run(req: RunRequest) -> RunState:
    state = RunState()
    runs[str(req.run_id)] = state
    state.task = asyncio.create_task(run(req))
    return state
