"""Tests for the Brand Foundation loader (design.md format)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app import brand as brand_loader


SAMPLE = """# Brand Foundation: Acme

> design.md format — see docs/DESIGN_MD.md.

## Promise

Make better espresso.

## Voice

- Calm.
- Plain.
- Specific.

## Banned words

synergy, leverage, unleash, 10x

## Preferred words

goal, outcome, plan

## Examples

- Don't: "Unleash your morning." → Do: "Pull a clean shot."
- Don't: "10x your day." → Do: "One good cup."

## Positioning

Better espresso, less hype.

## Closing line

End with: Decision needed.
"""


def test_parse_recognises_all_sections():
    out = brand_loader.parse(SAMPLE)
    assert out["promise"] == "Make better espresso."
    assert out["voice"] == ["Calm.", "Plain.", "Specific."]
    assert out["banned"] == ["synergy", "leverage", "unleash", "10x"]
    assert out["preferred"] == ["goal", "outcome", "plan"]
    assert len(out["examples"]) == 2  # type: ignore[arg-type]
    assert out["positioning"].startswith("Better espresso")  # type: ignore[union-attr]
    assert "Decision needed" in out["closing"]  # type: ignore[operator]


def test_parse_skips_blockquote_preamble():
    out = brand_loader.parse(SAMPLE)
    # The preamble starts with `>` and must not bleed into Promise.
    assert "design.md format" not in out["promise"]  # type: ignore[operator]


def test_parse_unknown_section_ignored():
    out = brand_loader.parse(SAMPLE + "\n## Random\n\nshould be ignored\n")
    assert "random" not in out


def test_parse_missing_section_absent():
    minimal = "# Brand\n\n## Promise\n\nHello.\n"
    out = brand_loader.parse(minimal)
    assert out == {"promise": "Hello."}


def test_system_prompt_block_includes_each_section():
    out = brand_loader.parse(SAMPLE)
    block = brand_loader.system_prompt_block(out)
    assert "[Brand Foundation]" in block
    assert "Promise: Make better espresso." in block
    assert "Voice: Calm.; Plain.; Specific." in block
    assert "Avoid these words and phrases: synergy, leverage, unleash, 10x" in block
    assert "Prefer these words: goal, outcome, plan" in block
    assert "Tone examples:" in block
    assert "Positioning: Better espresso, less hype." in block


def test_system_prompt_block_empty_dict_returns_empty():
    assert brand_loader.system_prompt_block({}) == ""


def test_find_banned_word_boundary():
    banned = ["10x", "unleash", "ninja"]
    text = "Let's unleash 10x growth with our ninja team."
    hits = brand_loader.find_banned(text, banned)
    assert set(hits) == {"unleash", "10x", "ninja"}


def test_find_banned_substring_does_not_falsely_match():
    banned = ["ai"]  # must not match 'pair', 'rain', etc.
    text = "We pair developers and watch the rain."
    assert brand_loader.find_banned(text, banned) == []


def test_find_banned_handles_phrases_and_hyphens():
    banned = ["next-gen", "paradigm shift"]
    text = "This next-gen tool drives a paradigm shift in coffee."
    hits = brand_loader.find_banned(text, banned)
    assert set(hits) == {"next-gen", "paradigm shift"}


def test_find_banned_empty_inputs():
    assert brand_loader.find_banned("", ["x"]) == []
    assert brand_loader.find_banned("text", []) == []


def test_load_missing_file_returns_empty(tmp_path: Path):
    out = brand_loader.load(tmp_path, "does-not-exist")
    assert out == {}


def test_load_reads_file(tmp_path: Path):
    (tmp_path / "acme.md").write_text(SAMPLE, encoding="utf-8")
    out = brand_loader.load(tmp_path, "acme")
    assert out["promise"] == "Make better espresso."


def test_load_real_blankcollar_file_present():
    """Repo-level brand/blankcollar.md must parse cleanly."""
    repo_root = Path(__file__).resolve().parents[3]
    out = brand_loader.load(repo_root / "brand", "blankcollar")
    assert out["promise"] == "Work is for bots. Life is for humans."
    assert "synergy" in out["banned"]  # type: ignore[operator]
    assert "goal" in out["preferred"]  # type: ignore[operator]
