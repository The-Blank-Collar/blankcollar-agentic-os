"""web.search skill — Oxylabs AI Studio with a DuckDuckGo fallback.

Why both:
  * In production on Hostinger, OXYLABS_API_KEY is set and we hit the AI
    Studio search endpoint with a Bearer token.
  * In local dev / CI without credits, we fall back to DuckDuckGo's
    Instant Answer endpoint (anonymous, no key required) so the demo
    runs and the contract surface stays the same.

The exact Oxylabs AI Studio request/response shape is gated behind their
account dashboard. Wire format here is conservative and configurable
(OXYLABS_BASE_URL / OXYLABS_SEARCH_PATH); confirm against the Integration
Code panel in your AI Studio dashboard if anything doesn't match.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger("openclaw.search")


class SearchError(RuntimeError):
    pass


async def web_search(query: str, *, max_results: int | None = None) -> dict[str, Any]:
    if not query.strip():
        raise SearchError("empty query")

    n = max_results or settings.oxylabs_default_results

    if settings.oxylabs_api_key:
        try:
            return await _oxylabs_search(query, n)
        except Exception as e:
            # Fall through to DDG so a transient outage doesn't kill a run.
            log.warning("oxylabs search failed (%s); falling back to duckduckgo", e)

    return await _ddg_search(query)


# ---------- Oxylabs AI Studio ---------------------------------------------


async def _oxylabs_search(query: str, n: int) -> dict[str, Any]:
    url = settings.oxylabs_base_url.rstrip("/") + settings.oxylabs_search_path
    headers = {
        "authorization": f"Bearer {settings.oxylabs_api_key}",
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": settings.fetch_user_agent,
    }
    payload = {
        # The AI Studio dashboard exposes these knobs in its UI; mirror them here.
        "query": query,
        "max_results": n,
        "include_content": False,
    }
    async with httpx.AsyncClient(timeout=settings.oxylabs_request_timeout_s) as client:
        r = await client.post(url, headers=headers, json=payload)
        r.raise_for_status()
        body = r.json()

    return _normalise_oxylabs(body, query=query)


def _normalise_oxylabs(body: dict[str, Any], *, query: str) -> dict[str, Any]:
    """Coerce the Oxylabs response into our canonical search shape.

    We accept several plausible shapes since the public docs don't pin one:
      - {"results": [...]} — preferred
      - {"data": {"results": [...]}}
      - {"organic": [...]}
      - {"items": [...]}
    Each result is normalised into {title, url, snippet}.
    """
    raw_results: list[dict[str, Any]] = []
    if isinstance(body.get("results"), list):
        raw_results = body["results"]
    elif isinstance(body.get("data"), dict) and isinstance(body["data"].get("results"), list):
        raw_results = body["data"]["results"]
    elif isinstance(body.get("organic"), list):
        raw_results = body["organic"]
    elif isinstance(body.get("items"), list):
        raw_results = body["items"]

    norm: list[dict[str, str]] = []
    for r in raw_results:
        if not isinstance(r, dict):
            continue
        title = r.get("title") or r.get("name") or r.get("heading") or ""
        url = r.get("url") or r.get("link") or r.get("href") or ""
        snippet = r.get("snippet") or r.get("description") or r.get("excerpt") or ""
        if url:
            norm.append({"title": str(title), "url": str(url), "snippet": str(snippet)})

    return {
        "provider": "oxylabs",
        "query": query,
        "results": norm,
        "raw": body if not norm else None,  # keep raw only when we couldn't normalise
    }


# ---------- DuckDuckGo Instant Answer (no key) ----------------------------


async def _ddg_search(query: str) -> dict[str, Any]:
    """DuckDuckGo's `format=json` Instant Answer — no auth, low rate limit.

    Returns at most a handful of related topics. Good enough for offline
    demo / CI; if you need real volume, set OXYLABS_API_KEY.
    """
    params = {"q": query, "format": "json", "no_redirect": "1", "no_html": "1"}
    headers = {"user-agent": settings.fetch_user_agent}
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            "https://api.duckduckgo.com/", params=params, headers=headers
        )
        r.raise_for_status()
        body = r.json()

    norm: list[dict[str, str]] = []
    for topic in body.get("RelatedTopics", []) or []:
        if not isinstance(topic, dict):
            continue
        url = topic.get("FirstURL")
        if not url:
            continue
        norm.append(
            {
                "title": topic.get("Text", "")[:200],
                "url": url,
                "snippet": topic.get("Result", "")[:300] or topic.get("Text", "")[:300],
            }
        )

    abstract = body.get("AbstractText") or body.get("Definition")
    if abstract and body.get("AbstractURL"):
        norm.insert(
            0,
            {
                "title": body.get("Heading") or query,
                "url": body["AbstractURL"],
                "snippet": abstract,
            },
        )

    return {
        "provider": "duckduckgo",
        "query": query,
        "results": norm,
        "raw": None,
    }
