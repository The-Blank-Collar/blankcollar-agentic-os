"""Tests for the email.send skill — pure address validation + drafted-mode."""

from __future__ import annotations

import pytest

from app.email import EmailSendError, _is_valid_address, email_send


def test_address_validator_accepts_normal_email() -> None:
    assert _is_valid_address("alice@example.com")
    assert _is_valid_address("agent@blankcollar.ai")


def test_address_validator_rejects_garbage() -> None:
    assert not _is_valid_address("")
    assert not _is_valid_address("not-an-email")
    assert not _is_valid_address("a@b")
    assert not _is_valid_address("a @b.com")


async def test_send_rejects_bad_to_address() -> None:
    with pytest.raises(EmailSendError):
        await email_send(to="not-an-email", subject="x", body="x")


async def test_send_rejects_bad_cc_address() -> None:
    with pytest.raises(EmailSendError):
        await email_send(
            to="alice@example.com", subject="x", body="x", cc=["nope"]
        )


async def test_send_without_smtp_credentials_returns_drafted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When SMTP_HOST/USER are empty, email_send returns drafted=False, status=drafted."""
    from app import config as cfg_mod

    monkeypatch.setattr(cfg_mod.settings, "smtp_host", "")
    monkeypatch.setattr(cfg_mod.settings, "smtp_user", "")

    out = await email_send(to="alice@example.com", subject="hi", body="hello")
    assert out["delivered"] is False
    assert out["status"] == "drafted"
    assert out["to"] == "alice@example.com"
