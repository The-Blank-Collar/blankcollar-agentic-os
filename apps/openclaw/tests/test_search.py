"""Tests for the web.search skill — covers Oxylabs response normalisation
across plausible shapes, since the public docs don't pin one.
"""

from __future__ import annotations

from app.search import _normalise_oxylabs


def test_normalises_results_key() -> None:
    body = {
        "results": [
            {"title": "Headline 1", "url": "https://a.com", "snippet": "..."},
            {"title": "Headline 2", "url": "https://b.com", "snippet": "..."},
        ],
    }
    out = _normalise_oxylabs(body, query="hi")
    assert out["provider"] == "oxylabs"
    assert out["query"] == "hi"
    assert len(out["results"]) == 2
    assert out["results"][0]["url"] == "https://a.com"
    assert out["raw"] is None


def test_normalises_data_results_key() -> None:
    body = {"data": {"results": [{"title": "X", "url": "https://x.io"}]}}
    out = _normalise_oxylabs(body, query="x")
    assert len(out["results"]) == 1
    assert out["results"][0]["url"] == "https://x.io"


def test_normalises_organic_key() -> None:
    body = {"organic": [{"name": "X", "link": "https://x.io", "description": "yo"}]}
    out = _normalise_oxylabs(body, query="x")
    assert out["results"][0]["title"] == "X"
    assert out["results"][0]["url"] == "https://x.io"
    assert out["results"][0]["snippet"] == "yo"


def test_normalises_items_key() -> None:
    body = {"items": [{"heading": "X", "href": "https://x.io"}]}
    out = _normalise_oxylabs(body, query="x")
    assert out["results"][0]["title"] == "X"
    assert out["results"][0]["url"] == "https://x.io"


def test_keeps_raw_when_unrecognised() -> None:
    body = {"unexpected": "shape"}
    out = _normalise_oxylabs(body, query="x")
    assert out["results"] == []
    assert out["raw"] == body


def test_skips_results_without_url() -> None:
    body = {"results": [{"title": "no url"}, {"title": "ok", "url": "https://ok.io"}]}
    out = _normalise_oxylabs(body, query="x")
    assert len(out["results"]) == 1
    assert out["results"][0]["url"] == "https://ok.io"
