"""Pure-function tests for the inbound-email parser."""

from __future__ import annotations

from app.parser import parse


def test_request_phrasing_is_actionable() -> None:
    p = parse(sender="x@y.com", subject="Quick favor", text="Please draft a reply.")
    assert p.is_actionable


def test_question_is_actionable() -> None:
    p = parse(sender="x@y.com", subject="thoughts", text="What do you think about this?")
    assert p.is_actionable


def test_pure_announcement_is_not_actionable() -> None:
    p = parse(sender="x@y.com", subject="FYI", text="Just letting you know we shipped on Friday.")
    assert not p.is_actionable


def test_research_keyword_actionable() -> None:
    p = parse(sender="x@y.com", subject="hi", text="Could you research the top three CRMs?")
    assert p.is_actionable


def test_memory_title_truncates_long_subject() -> None:
    p = parse(sender="x@y.com", subject="A" * 500, text="body")
    assert len(p.memory_title) <= 200


def test_memory_content_includes_metadata_block() -> None:
    p = parse(sender="alice@example.com", subject="hi", text="hey")
    assert "From: alice@example.com" in p.memory_content
    assert "Subject: hi" in p.memory_content
    assert "hey" in p.memory_content


def test_goal_title_falls_back_to_first_line_when_no_subject() -> None:
    p = parse(sender="x@y.com", subject="", text="Find me a CRM.\nMore details below.")
    assert p.goal_title.startswith("Find me a CRM")
