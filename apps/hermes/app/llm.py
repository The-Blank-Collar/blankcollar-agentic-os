"""LLM providers for Hermes.

Provider preference (first match wins):
  1. Portkey (Anthropic-routed) — production default. Every call is logged
     in the Portkey dashboard with cost + latency + trace_id.
  2. FakeLLM — deterministic offline fallback used by tests and by any
     dev environment that hasn't configured Portkey yet. The startup
     guard in main.py refuses to boot a non-test process without
     Portkey, so this branch should not fire in production.

The Anthropic Python SDK accepts a `base_url` argument; we point it at
Portkey's gateway and add `x-portkey-*` headers so requests passthrough
to Anthropic with full observability. Wire format is unchanged.
"""

from __future__ import annotations

import logging
from typing import Protocol

from app.config import settings

log = logging.getLogger("hermes.llm")


class LLM(Protocol):
    name: str

    async def complete(self, *, system: str, user: str) -> str: ...


# ---------- Portkey (Anthropic via the AI gateway) -------------------------


class PortkeyLLM:
    """Anthropic SDK client routed through Portkey.

    Portkey accepts Anthropic-shaped payloads at /v1/messages with the
    auth done via x-portkey-api-key + x-portkey-virtual-key headers. The
    SDK's own api_key argument is unused on the Portkey side but the
    SDK refuses to construct without one — we pass an explicit
    placeholder so the auth path is unambiguous.
    """

    name = "portkey"

    def __init__(
        self,
        *,
        portkey_api_key: str,
        virtual_key: str,
        base_url: str,
        model: str,
        max_tokens: int,
    ) -> None:
        from anthropic import AsyncAnthropic as _Client

        # Model Catalog routing (`@workspace/model`) carries provider info
        # in the model name; passing the legacy virtual-key header is a 400
        # in that case. Only attach it when set.
        headers: dict[str, str] = {"x-portkey-api-key": portkey_api_key}
        if virtual_key:
            headers["x-portkey-virtual-key"] = virtual_key

        self._client = _Client(
            api_key="portkey-handles-this",
            base_url=base_url,
            default_headers=headers,
        )
        self._model = model
        self._max_tokens = max_tokens

    async def complete(self, *, system: str, user: str) -> str:
        msg = await self._client.messages.create(
            model=self._model,
            max_tokens=self._max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        parts: list[str] = []
        for block in msg.content:
            if getattr(block, "type", None) == "text":
                parts.append(block.text)
        return "\n".join(p for p in parts if p).strip()


# ---------- Deterministic fake (no API key) -------------------------------


class FakeLLM:
    """No-key fallback. Returns a structured, deterministic stand-in.

    Used by tests and by any pre-Portkey dev process that imports llm.py
    directly. Production startups go through require_runtime_config()
    which refuses to boot without Portkey, so this branch does not fire
    in deployed environments.
    """

    name = "fake"

    async def complete(self, *, system: str, user: str) -> str:
        head = "FAKE-LLM (set PORTKEY_API_KEY + PORTKEY_VIRTUAL_KEY_ANTHROPIC for real answers)"
        sys_excerpt = (system[:160] + "…") if len(system) > 160 else system
        user_excerpt = (user[:240] + "…") if len(user) > 240 else user
        return (
            f"[{head}]\n"
            f"Inferred role: {sys_excerpt}\n"
            f"On the input: {user_excerpt}\n"
            f"Decision: continue with a stub response so the pipeline stays observable."
        )


def make_llm() -> LLM:
    import os

    fake_override = os.environ.get("BLANKCOLLAR_FAKE_LLM", "").lower() == "true"
    if fake_override:
        log.warning("hermes.llm=FAKE (BLANKCOLLAR_FAKE_LLM=true)")
        return FakeLLM()

    using_model_catalog = settings.model.startswith("@")
    has_creds = settings.portkey_api_key and (
        using_model_catalog or settings.portkey_virtual_key_anthropic
    )
    if has_creds:
        log.info(
            "hermes.llm=portkey base=%s model=%s",
            settings.portkey_base_url,
            settings.model,
        )
        return PortkeyLLM(
            portkey_api_key=settings.portkey_api_key,
            virtual_key=settings.portkey_virtual_key_anthropic or "",
            base_url=settings.portkey_base_url,
            model=settings.model,
            max_tokens=settings.max_tokens,
        )

    log.warning(
        "hermes.llm=FAKE — set PORTKEY_API_KEY (and either HERMES_MODEL=@workspace/model "
        "or PORTKEY_VIRTUAL_KEY_ANTHROPIC) for real reasoning. Service stays runnable; "
        "answers are deterministic stand-ins."
    )
    return FakeLLM()
