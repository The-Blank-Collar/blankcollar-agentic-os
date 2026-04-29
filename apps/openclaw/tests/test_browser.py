"""Tests for web.browse — same URL-safety guard as web.fetch (we reuse
_is_safe_url) plus argument validation. We don't actually launch Chromium
in the unit tests; that lives in integration/E2E."""

from __future__ import annotations

import pytest

from app.browser import BrowseError, web_browse


@pytest.mark.asyncio
async def test_rejects_non_http_scheme() -> None:
    with pytest.raises(BrowseError):
        await web_browse("ftp://example.com")


@pytest.mark.asyncio
async def test_rejects_loopback_ip() -> None:
    with pytest.raises(BrowseError):
        await web_browse("http://127.0.0.1/")


@pytest.mark.asyncio
async def test_rejects_private_ip() -> None:
    with pytest.raises(BrowseError):
        await web_browse("http://10.0.0.1/")


@pytest.mark.asyncio
async def test_rejects_imds_ip() -> None:
    """AWS instance metadata service — must never be reachable from agents."""
    with pytest.raises(BrowseError):
        await web_browse("http://169.254.169.254/latest/meta-data/")


@pytest.mark.asyncio
async def test_rejects_invalid_wait_until() -> None:
    with pytest.raises(BrowseError):
        await web_browse("https://example.com", wait_until="instant")


@pytest.mark.asyncio
async def test_rejects_javascript_url() -> None:
    with pytest.raises(BrowseError):
        await web_browse("javascript:alert(1)")
