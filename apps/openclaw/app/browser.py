"""web.browse — full-fidelity URL load using Playwright + headless Chromium.

Where `web.fetch` does a plain HTTP GET and parses static HTML, `web.browse`
runs a real browser: it executes JavaScript, follows redirects, handles
cookies, and waits for the page to settle. Use it for SPAs, paywalled
sites, or anything that needs DOM interaction.

Politeness mirrors web.fetch: the same URL-safety rules (no IP literals on
private/loopback ranges), the same declared user agent, similar size caps.
"""

from __future__ import annotations

import logging
from typing import Any

from app.config import settings
from app.fetch import _is_safe_url  # reuse the well-tested URL guard

log = logging.getLogger("openclaw.browser")


class BrowseError(RuntimeError):
    pass


async def web_browse(
    url: str,
    *,
    wait_until: str = "networkidle",
    screenshot: bool = False,
) -> dict[str, Any]:
    """Load `url` in headless Chromium and return rendered text + metadata.

    Args:
        url: target URL. Must pass _is_safe_url.
        wait_until: playwright's load condition. One of:
            "load", "domcontentloaded", "networkidle", "commit".
        screenshot: if True, also capture a PNG (base64-encoded in result).
    """
    if not _is_safe_url(url):
        raise BrowseError(f"refused unsafe url: {url!r}")
    if wait_until not in ("load", "domcontentloaded", "networkidle", "commit"):
        raise BrowseError(f"invalid wait_until: {wait_until!r}")

    # Imported lazily so the rest of OpenClaw boots even if Chromium is
    # missing from the image (e.g. dev containers without --with-deps).
    try:
        from playwright.async_api import async_playwright  # type: ignore
    except Exception as e:
        raise BrowseError(f"playwright not installed: {e}") from e

    timeout_ms = int(settings.browser_timeout_s * 1000)

    log.info("browsing %s (wait_until=%s)", url, wait_until)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context(
                user_agent=settings.fetch_user_agent,
                viewport={"width": settings.browser_viewport_w, "height": settings.browser_viewport_h},
            )
            page = await context.new_page()
            response = await page.goto(url, wait_until=wait_until, timeout=timeout_ms)

            status = response.status if response else 0
            final_url = page.url
            title = await page.title()
            text = await page.inner_text("body")
            text = text[: settings.text_excerpt_chars] if text else ""

            png_b64: str | None = None
            if screenshot:
                import base64

                raw = await page.screenshot(full_page=False, type="png")
                if len(raw) <= settings.browser_max_screenshot_bytes:
                    png_b64 = base64.b64encode(raw).decode("ascii")

            return {
                "url": url,
                "final_url": final_url,
                "status": status,
                "title": title,
                "excerpt": text,
                "screenshot_png_b64": png_b64,
                "viewport": {
                    "w": settings.browser_viewport_w,
                    "h": settings.browser_viewport_h,
                },
            }
        finally:
            await browser.close()
