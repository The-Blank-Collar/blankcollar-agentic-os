"""Provider-selection precedence: Nexos > Anthropic > Fake.

Doesn't make real API calls — just checks `make_llm()` picks the right class
based on which env vars are set. We monkey-patch the SDKs so the constructors
don't try to validate credentials.
"""

from __future__ import annotations

import importlib
import sys
import types

import pytest


def _stub_openai() -> None:
    """Provide a tiny stub `openai` module so NexosLLM can be constructed."""
    fake = types.ModuleType("openai")

    class _AsyncOpenAI:
        def __init__(self, *_, **__) -> None:  # type: ignore[no-untyped-def]
            pass

    fake.AsyncOpenAI = _AsyncOpenAI  # type: ignore[attr-defined]
    sys.modules["openai"] = fake


def _stub_anthropic() -> None:
    fake = types.ModuleType("anthropic")

    class _AsyncAnthropic:
        def __init__(self, *_, **__) -> None:  # type: ignore[no-untyped-def]
            pass

    fake.AsyncAnthropic = _AsyncAnthropic  # type: ignore[attr-defined]
    sys.modules["anthropic"] = fake


@pytest.fixture(autouse=True)
def _stubs() -> None:
    _stub_openai()
    _stub_anthropic()


def _reload_modules() -> tuple[object, object]:
    # Force config + llm modules to re-read the patched env.
    for mod in ("app.config", "app.llm"):
        if mod in sys.modules:
            del sys.modules[mod]
    config_mod = importlib.import_module("app.config")
    llm_mod = importlib.import_module("app.llm")
    return config_mod, llm_mod


def test_nexos_wins_when_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NEXOS_API_KEY", "nx-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "ant-test")
    _, llm_mod = _reload_modules()
    instance = llm_mod.make_llm()
    assert instance.name == "nexos"


def test_anthropic_when_only_anthropic_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NEXOS_API_KEY", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "ant-test")
    _, llm_mod = _reload_modules()
    instance = llm_mod.make_llm()
    assert instance.name == "anthropic"


def test_fake_when_no_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NEXOS_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    _, llm_mod = _reload_modules()
    instance = llm_mod.make_llm()
    assert instance.name == "fake"
