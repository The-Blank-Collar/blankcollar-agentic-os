"""Provider-selection precedence: Portkey when configured, FakeLLM otherwise.

Doesn't make real API calls — just checks `make_llm()` picks the right
class based on which env vars are set, and `require_runtime_config()`
fails fast on missing keys. We monkey-patch the SDK so the constructor
doesn't try to validate credentials.
"""

from __future__ import annotations

import importlib
import sys
import types

import pytest


def _stub_anthropic() -> None:
    """Provide a tiny stub `anthropic` module so PortkeyLLM can be constructed."""
    fake = types.ModuleType("anthropic")

    class _AsyncAnthropic:
        def __init__(self, *_, **__) -> None:  # type: ignore[no-untyped-def]
            pass

    fake.AsyncAnthropic = _AsyncAnthropic  # type: ignore[attr-defined]
    sys.modules["anthropic"] = fake


@pytest.fixture(autouse=True)
def _stubs() -> None:
    _stub_anthropic()


def _reload_modules() -> tuple[object, object]:
    # Force config + llm modules to re-read the patched env.
    for mod in ("app.config", "app.llm"):
        if mod in sys.modules:
            del sys.modules[mod]
    config_mod = importlib.import_module("app.config")
    llm_mod = importlib.import_module("app.llm")
    return config_mod, llm_mod


def _clear_legacy(monkeypatch: pytest.MonkeyPatch) -> None:
    """Older env vars that no longer participate in selection — remove so the
    test environment matches a fresh shell."""
    for key in ("ANTHROPIC_API_KEY", "NEXOS_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(key, raising=False)


def test_portkey_when_both_keys_set(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_legacy(monkeypatch)
    monkeypatch.setenv("PORTKEY_API_KEY", "pk-test")
    monkeypatch.setenv("PORTKEY_VIRTUAL_KEY_ANTHROPIC", "vk-anth-test")
    _, llm_mod = _reload_modules()
    instance = llm_mod.make_llm()
    assert instance.name == "portkey"


def test_fake_when_no_portkey_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_legacy(monkeypatch)
    monkeypatch.delenv("PORTKEY_API_KEY", raising=False)
    monkeypatch.delenv("PORTKEY_VIRTUAL_KEY_ANTHROPIC", raising=False)
    _, llm_mod = _reload_modules()
    instance = llm_mod.make_llm()
    assert instance.name == "fake"


def test_fake_when_only_portkey_api_key_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """Both keys are required; one alone is not enough."""
    _clear_legacy(monkeypatch)
    monkeypatch.setenv("PORTKEY_API_KEY", "pk-test")
    monkeypatch.delenv("PORTKEY_VIRTUAL_KEY_ANTHROPIC", raising=False)
    _, llm_mod = _reload_modules()
    instance = llm_mod.make_llm()
    assert instance.name == "fake"


def test_fake_when_only_virtual_key_set(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_legacy(monkeypatch)
    monkeypatch.delenv("PORTKEY_API_KEY", raising=False)
    monkeypatch.setenv("PORTKEY_VIRTUAL_KEY_ANTHROPIC", "vk-test")
    _, llm_mod = _reload_modules()
    instance = llm_mod.make_llm()
    assert instance.name == "fake"


def test_require_runtime_config_raises_when_keys_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_legacy(monkeypatch)
    monkeypatch.delenv("PORTKEY_API_KEY", raising=False)
    monkeypatch.delenv("PORTKEY_VIRTUAL_KEY_ANTHROPIC", raising=False)
    config_mod, _ = _reload_modules()
    with pytest.raises(RuntimeError, match="PORTKEY_API_KEY"):
        config_mod.require_runtime_config()


def test_require_runtime_config_lists_all_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_legacy(monkeypatch)
    monkeypatch.delenv("PORTKEY_API_KEY", raising=False)
    monkeypatch.delenv("PORTKEY_VIRTUAL_KEY_ANTHROPIC", raising=False)
    config_mod, _ = _reload_modules()
    with pytest.raises(RuntimeError, match="PORTKEY_VIRTUAL_KEY_ANTHROPIC"):
        config_mod.require_runtime_config()


def test_require_runtime_config_succeeds_when_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_legacy(monkeypatch)
    monkeypatch.setenv("PORTKEY_API_KEY", "pk-test")
    monkeypatch.setenv("PORTKEY_VIRTUAL_KEY_ANTHROPIC", "vk-test")
    config_mod, _ = _reload_modules()
    config_mod.require_runtime_config()  # must not raise


def test_portkey_uses_anthropic_sdk_with_correct_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PortkeyLLM constructs the AsyncAnthropic client with base_url + the
    two x-portkey-* headers. Spy on the constructor to assert wiring."""
    _clear_legacy(monkeypatch)
    monkeypatch.setenv("PORTKEY_API_KEY", "pk-spy")
    monkeypatch.setenv("PORTKEY_VIRTUAL_KEY_ANTHROPIC", "vk-spy")
    monkeypatch.setenv("PORTKEY_BASE_URL", "https://gateway.example/v1")

    captured: dict[str, object] = {}

    fake = types.ModuleType("anthropic")

    class _SpyClient:
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            captured.update(kwargs)

    fake.AsyncAnthropic = _SpyClient  # type: ignore[attr-defined]
    sys.modules["anthropic"] = fake

    _, llm_mod = _reload_modules()
    llm_mod.make_llm()

    assert captured["base_url"] == "https://gateway.example/v1"
    headers = captured["default_headers"]
    assert isinstance(headers, dict)
    assert headers["x-portkey-api-key"] == "pk-spy"
    assert headers["x-portkey-virtual-key"] == "vk-spy"
