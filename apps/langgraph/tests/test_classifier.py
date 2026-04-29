"""Tests for the keyword classifier — the routing decision is what
determines which agent does the work, so wrong routing = wrong agent
output. Keep these comprehensive."""

from __future__ import annotations

from app.classifier import classify_keywords


def _c(title: str = "", description: str = "", **inputs):
    return classify_keywords(title=title, description=description, sub_input=inputs)


# ---------- explicit skill markers ---------------------------------------


def test_explicit_web_fetch_skill_routes_openclaw() -> None:
    assert _c(skill="web.fetch", url="https://example.com") == "openclaw"


def test_explicit_web_search_skill_routes_openclaw() -> None:
    assert _c(skill="web.search", query="best CRM for SaaS") == "openclaw"


def test_explicit_email_send_skill_routes_openclaw() -> None:
    assert _c(skill="email.send", to="alice@example.com") == "openclaw"


def test_explicit_reason_skill_routes_hermes() -> None:
    assert _c(skill="reason") == "hermes"


# ---------- URL detection ------------------------------------------------


def test_url_in_title_routes_openclaw() -> None:
    assert _c("Summarise https://news.ycombinator.com/") == "openclaw"


def test_url_in_description_routes_openclaw() -> None:
    assert _c("Brief me", description="Source: http://example.com/x") == "openclaw"


def test_url_in_input_value_routes_openclaw() -> None:
    assert _c("anything", source_url="https://blankcollar.ai") == "openclaw"


# ---------- web verbs ----------------------------------------------------


def test_research_verb_routes_openclaw() -> None:
    assert _c("Research the top three CRMs") == "openclaw"


def test_email_verb_routes_openclaw() -> None:
    assert _c("Email Alice about Friday's release") == "openclaw"


def test_send_to_routes_openclaw() -> None:
    assert _c("Send an update to the customer") == "openclaw"


# ---------- reasoning verbs ----------------------------------------------


def test_summarise_routes_hermes() -> None:
    assert _c("Summarise yesterday's meeting") == "hermes"


def test_outline_routes_hermes() -> None:
    assert _c("Outline a launch plan") == "hermes"


def test_draft_routes_hermes() -> None:
    assert _c("Draft a follow-up note") == "hermes"


def test_decide_routes_hermes() -> None:
    assert _c("Decide whether to extend the deadline") == "hermes"


# ---------- defaults -----------------------------------------------------


def test_no_clear_signal_defaults_to_hermes() -> None:
    assert _c("Something vague") == "hermes"


def test_url_overrides_reasoning_verb() -> None:
    """A URL is a stronger signal than a reasoning verb."""
    assert _c("Summarise https://example.com/article") == "openclaw"


def test_explicit_skill_overrides_text_verbs() -> None:
    """When a skill is explicitly named in input, trust it over the prose."""
    assert _c("Decide what to do", skill="web.fetch", url="https://x.io") == "openclaw"
