"""LLM providers for Hermes.

Provider preference (first match wins):
  1. Nexos.ai     — OpenAI-compatible, base https://api.nexos.ai/v1
                     (Hostinger-issued credits; the production default).
  2. Anthropic    — direct Claude API (handy for local dev).
  3. FakeLLM      — deterministic offline fallback so the demo stays runnable.

A loud INFO/WARNING line on startup says which one is active.
"""

from __future__ import annotations

import logging
from typing import Protocol

from app.config import settings

log = logging.getLogger("hermes.llm")


class LLM(Protocol):
    name: str

    async def complete(self, *, system: str, user: str) -> str: ...


# ---------- Nexos.ai (OpenAI-compatible) -----------------------------------


class NexosLLM:
    """Nexos.ai uses the OpenAI Chat Completions wire format. We use the
    official `openai` SDK pointed at the Nexos base URL.

    Note: per Hostinger's nexos.ai guide, *do not* use the newer Responses API —
    Nexos targets the classic Chat Completions endpoint.
    """

    name = "nexos"

    def __init__(self, api_key: str, base_url: str, model: str, max_tokens: int) -> None:
        from openai import AsyncOpenAI

        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._model = model
        self._max_tokens = max_tokens

    async def complete(self, *, system: str, user: str) -> str:
        resp = await self._client.chat.completions.create(
            model=self._model,
            max_tokens=self._max_tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        choice = resp.choices[0]
        content = choice.message.content or ""
        return content.strip()


# ---------- Anthropic (direct) ---------------------------------------------


class AnthropicLLM:
    name = "anthropic"

    def __init__(self, api_key: str, model: str, max_tokens: int) -> None:
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
        parts: list[str] = []
        for block in msg.content:
            if getattr(block, "type", None) == "text":
                parts.append(block.text)
        return "\n".join(p for p in parts if p).strip()


# ---------- Deterministic fake (no API key) -------------------------------


class FakeLLM:
    """No-key fallback. Returns a structured, deterministic stand-in."""

    name = "fake"

    async def complete(self, *, system: str, user: str) -> str:
        head = "FAKE-LLM (set NEXOS_API_KEY or ANTHROPIC_API_KEY for real answers)"
        sys_excerpt = (system[:160] + "…") if len(system) > 160 else system
        user_excerpt = (user[:240] + "…") if len(user) > 240 else user
        return (
            f"[{head}]\n"
            f"Inferred role: {sys_excerpt}\n"
            f"On the input: {user_excerpt}\n"
            f"Decision: continue with a stub response so the pipeline stays observable."
        )


def make_llm() -> LLM:
    if settings.nexos_api_key:
        log.info(
            "hermes.llm=nexos base=%s model=%s",
            settings.nexos_base_url,
            settings.nexos_model,
        )
        return NexosLLM(
            api_key=settings.nexos_api_key,
            base_url=settings.nexos_base_url,
            model=settings.nexos_model,
            max_tokens=settings.max_tokens,
        )

    if settings.anthropic_api_key:
        log.info("hermes.llm=anthropic model=%s", settings.model)
        return AnthropicLLM(
            api_key=settings.anthropic_api_key,
            model=settings.model,
            max_tokens=settings.max_tokens,
        )

    log.warning(
        "hermes.llm=FAKE — set NEXOS_API_KEY or ANTHROPIC_API_KEY for real reasoning. "
        "Service stays runnable; answers are deterministic stand-ins."
    )
    return FakeLLM()
