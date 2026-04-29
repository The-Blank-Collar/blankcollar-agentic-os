"""Tests for the nango.invoke skill — pure-function validation. We don't
hit Nango's HTTP API in unit tests; that's covered by integration runs."""

from __future__ import annotations

import pytest

from app.nango import NangoError, _validate_endpoint, nango_invoke


# ---------- _validate_endpoint ------------------------------------------


def test_endpoint_path_ok() -> None:
    assert _validate_endpoint("/api/chat.postMessage") == "/api/chat.postMessage"


def test_endpoint_full_url_ok() -> None:
    assert _validate_endpoint("https://slack.com/api/users.info") == "https://slack.com/api/users.info"


def test_endpoint_empty_rejected() -> None:
    with pytest.raises(NangoError):
        _validate_endpoint("")
    with pytest.raises(NangoError):
        _validate_endpoint("   ")


def test_endpoint_with_newline_rejected() -> None:
    """CRLF-injection guard."""
    with pytest.raises(NangoError):
        _validate_endpoint("/api/x\r\nX-Header: pwned")


def test_endpoint_too_long_rejected() -> None:
    with pytest.raises(NangoError):
        _validate_endpoint("/api/" + "a" * 2_500)


# ---------- nango_invoke argument validation ----------------------------


@pytest.mark.asyncio
async def test_no_secret_key_returns_clear_error(monkeypatch) -> None:
    """When NANGO_SECRET_KEY is empty, the skill should refuse with a
    helpful message instead of attempting a transport call."""
    from app import config as cfg_mod

    monkeypatch.setattr(cfg_mod.settings, "nango_secret_key", None)

    with pytest.raises(NangoError, match="NANGO_SECRET_KEY"):
        await nango_invoke(
            provider_config_key="slack",
            connection_id="c1",
            endpoint="/api/users.info",
        )


@pytest.mark.asyncio
async def test_missing_provider_rejected(monkeypatch) -> None:
    from app import config as cfg_mod

    monkeypatch.setattr(cfg_mod.settings, "nango_secret_key", "test-key")

    with pytest.raises(NangoError, match="provider_config_key"):
        await nango_invoke(
            provider_config_key="",
            connection_id="c1",
            endpoint="/api/x",
        )


@pytest.mark.asyncio
async def test_missing_connection_rejected(monkeypatch) -> None:
    from app import config as cfg_mod

    monkeypatch.setattr(cfg_mod.settings, "nango_secret_key", "test-key")

    with pytest.raises(NangoError, match="connection_id"):
        await nango_invoke(
            provider_config_key="slack",
            connection_id="",
            endpoint="/api/x",
        )


@pytest.mark.asyncio
async def test_invalid_method_rejected(monkeypatch) -> None:
    from app import config as cfg_mod

    monkeypatch.setattr(cfg_mod.settings, "nango_secret_key", "test-key")

    with pytest.raises(NangoError, match="unsupported method"):
        await nango_invoke(
            provider_config_key="slack",
            connection_id="c1",
            endpoint="/api/x",
            method="OPTIONS",
        )
