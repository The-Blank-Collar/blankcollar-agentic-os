"""web.fetch — the only skill OpenClaw ships with in v0.

Politeness controls: timeout, content-length cap, declared user agent, only
http(s) schemes, refusal of private/loopback IP literals.
"""

from __future__ import annotations

import ipaddress
import logging
from typing import Any
from urllib.parse import urlparse

import httpx
from selectolax.parser import HTMLParser

from app.config import settings

log = logging.getLogger("openclaw.fetch")


class FetchError(RuntimeError):
    pass


def _is_safe_url(url: str) -> bool:
    try:
        p = urlparse(url)
    except Exception:
        return False
    if p.scheme not in ("http", "https"):
        return False
    if not p.hostname:
        return False
    # Refuse IP-literal hosts that point at private / loopback ranges.
    try:
        ip = ipaddress.ip_address(p.hostname)
    except ValueError:
        return True  # hostname, not a literal — OK at this layer
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved)


def _extract_text(content_type: str, raw: bytes) -> tuple[str, str | None]:
    """Return (excerpt_text, page_title?)."""
    if "html" in content_type.lower():
        try:
            tree = HTMLParser(raw.decode("utf-8", errors="replace"))
        except Exception:
            return raw.decode("utf-8", errors="replace")[: settings.text_excerpt_chars], None
        title_node = tree.css_first("title")
        title = title_node.text(strip=True) if title_node else None
        # Strip script/style noise.
        for tag in ("script", "style", "noscript"):
            for n in tree.css(tag):
                n.decompose()
        body = tree.body
        text = body.text(separator=" ", strip=True) if body else tree.text(strip=True)
        return text[: settings.text_excerpt_chars], title
    # Treat anything else as text.
    return raw.decode("utf-8", errors="replace")[: settings.text_excerpt_chars], None


async def web_fetch(url: str) -> dict[str, Any]:
    if not _is_safe_url(url):
        raise FetchError(f"refused unsafe url: {url!r}")

    headers = {"user-agent": settings.fetch_user_agent, "accept": "text/html,*/*;q=0.5"}
    log.info("fetching %s", url)

    async with httpx.AsyncClient(
        timeout=settings.fetch_timeout_s,
        follow_redirects=True,
        headers=headers,
    ) as client:
        async with client.stream("GET", url) as r:
            content_type = r.headers.get("content-type", "")
            buf = bytearray()
            async for chunk in r.aiter_bytes():
                buf.extend(chunk)
                if len(buf) >= settings.fetch_max_bytes:
                    break
            r.raise_for_status()
            final_url = str(r.url)
            status = r.status_code
            content_length = len(buf)

    excerpt, title = _extract_text(content_type, bytes(buf))

    return {
        "url": url,
        "final_url": final_url,
        "status": status,
        "content_type": content_type,
        "content_length": content_length,
        "title": title,
        "excerpt": excerpt,
        "truncated": content_length >= settings.fetch_max_bytes,
    }
