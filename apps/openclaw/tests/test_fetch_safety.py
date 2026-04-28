"""Pure-function tests for OpenClaw's safety guards and HTML extraction."""

from __future__ import annotations

from app.fetch import _extract_text, _is_safe_url


# ---------- URL safety -----------------------------------------------------


def test_https_hostname_is_safe() -> None:
    assert _is_safe_url("https://news.ycombinator.com/")


def test_http_hostname_is_safe() -> None:
    assert _is_safe_url("http://example.com/")


def test_non_http_scheme_refused() -> None:
    assert not _is_safe_url("ftp://example.com/file")
    assert not _is_safe_url("file:///etc/passwd")
    assert not _is_safe_url("javascript:alert(1)")


def test_loopback_ip_refused() -> None:
    assert not _is_safe_url("http://127.0.0.1/")
    assert not _is_safe_url("http://[::1]/")


def test_private_ip_refused() -> None:
    assert not _is_safe_url("http://10.0.0.1/")
    assert not _is_safe_url("http://192.168.1.1/")
    assert not _is_safe_url("http://169.254.169.254/latest/meta-data/")  # AWS IMDS — explicitly refused


def test_garbage_refused() -> None:
    assert not _is_safe_url("not-a-url")
    assert not _is_safe_url("")


# ---------- Text extraction ------------------------------------------------


def test_extract_html_pulls_title_and_body() -> None:
    html = b"""
    <html>
      <head><title>Hello world</title></head>
      <body>
        <script>var x=1;</script>
        <style>body{color:red}</style>
        <p>Headline of the day.</p>
        <p>Second paragraph.</p>
      </body>
    </html>
    """
    text, title = _extract_text("text/html; charset=utf-8", html)
    assert title == "Hello world"
    assert "Headline of the day." in text
    assert "Second paragraph." in text
    assert "var x=1" not in text  # script removed
    assert "color:red" not in text  # style removed


def test_extract_plain_text_passthrough() -> None:
    text, title = _extract_text("text/plain", b"raw plain content")
    assert title is None
    assert "raw plain content" in text


def test_extract_html_without_title_returns_none() -> None:
    html = b"<html><body>just body</body></html>"
    text, title = _extract_text("text/html", html)
    assert title is None
    assert "just body" in text
