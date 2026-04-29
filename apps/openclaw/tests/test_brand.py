"""Tests for the Brand Foundation loader on the OpenClaw side.

OpenClaw uses the same loader as Hermes; the tests here focus on the
banned-word lint surface that wraps `email.send` outputs.
"""

from __future__ import annotations

from pathlib import Path

from app import brand as brand_loader


def test_real_blankcollar_file_parses():
    repo_root = Path(__file__).resolve().parents[3]
    out = brand_loader.load(repo_root / "brand", "blankcollar")
    assert out["promise"]
    assert out["banned"]


def test_email_lint_flags_known_bad_phrases():
    banned = ["synergy", "10x", "next-gen"]
    subject = "10x your team's synergy"
    body = "Our next-gen platform unlocks more synergy."
    hits = brand_loader.find_banned(f"{subject}\n{body}", banned)
    assert set(hits) == {"synergy", "10x", "next-gen"}


def test_email_lint_clean_returns_empty():
    banned = ["synergy", "10x"]
    body = "Hi — quick note about Tuesday's meeting. — Kristian"
    assert brand_loader.find_banned(body, banned) == []


def test_email_lint_case_insensitive():
    banned = ["disrupt"]
    body = "We DISRUPT industries."
    assert brand_loader.find_banned(body, banned) == ["disrupt"]
