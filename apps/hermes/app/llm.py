"""LLM provider for Hermes.

Default: Anthropic Claude. Fallback: a deterministic, no-API-key "summarizer"
that lets the demo run offline. A loud WARNING log line says when the fake
is in effect.
"""

from __future__ import annotations

import logging
from typing import Protocol

from app.config import settings

log = logging.getLogger("hermes.llm")


class LLM(Protocol):
    name: str

    async def complete(self, *, system: str, user: str) -> str: ...


class AnthropicLLM:
    name = "anthropic"

    def __init__(self, api_key: str, model: str, max_tokens: int) -> None:
        # Imported lazily so the fake mode doesn't need the SDK installed at runtime.
        from anthropic import AsyncAnthropic  # noqa: F401  (just verifying availability)
        from anthropic import AsyncAnthropic as _Client

        self._client = _Client(api_key=api_key)
        self._model = model
        self._max_tokens = max_tokens

    async def complete(self, *, system: str, user: str) -> str:
        msg = await self._client.messages.create(
            model=self._model,
            max_tokens=self._max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        # Concatenate text blocks; ignore tool-use blocks for v0.
        parts: list[str] = []
        for block in msg.content:
            if getattr(block, "type", None) == "text":
                parts.append(block.text)
        return "\n".join(p for p in parts if p).strip()


class FakeLLM:
    """No-key fallback. Returns a structured, deterministic stand-in.

    Useful for the demo when ANTHROPIC_API_KEY is not set: the agent still
    goes through its motions and writes a real episode memory.
    """

    name = "fake"

    async def complete(self, *, system: str, user: str) -> str:
        head = "FAKE-LLM (set ANTHROPIC_API_KEY for real answers)"
        # Trim aggressively so the fake response stays short and deterministic.
        sys_excerpt = (system[:160] + "…") if len(system) > 160 else system
        user_excerpt = (user[:240] + "…") if len(user) > 240 else user
        return (
            f"[{head}]\n"
            f"Inferred role: {sys_excerpt}\n"
            f"On the input: {user_excerpt}\n"
            f"Decision: continue with a stub response so the pipeline stays observable."
        )


def make_llm() -> LLM:
    if settings.anthropic_api_key:
        log.info("hermes.llm=anthropic model=%s", settings.model)
        return AnthropicLLM(
            api_key=settings.anthropic_api_key,
            model=settings.model,
            max_tokens=settings.max_tokens,
        )
    log.warning(
        "hermes.llm=FAKE — set ANTHROPIC_API_KEY for real reasoning. "
        "Service stays runnable; answers are deterministic stand-ins."
    )
    return FakeLLM()
