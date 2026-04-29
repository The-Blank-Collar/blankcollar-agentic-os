"""Classifier — decides which agent should handle a given subtask.

Two modes:
  1. LLM-driven (Nexos / Anthropic / OpenAI configured) — sends the
     subtask to a small completion and returns the model's verdict.
  2. Keyword-only (no LLM key) — pure-function pattern matching against
     the subtask text. Deterministic and testable.

Returns one of: "openclaw" (web/tool actions), "hermes" (reasoning,
drafting, summarising), or "finish" (no further work — return the input).
"""

from __future__ import annotations

import logging
import re
from typing import Literal

from app.config import settings

log = logging.getLogger("langgraph.classifier")

Decision = Literal["hermes", "openclaw", "finish"]


_URL_RE = re.compile(r"\bhttps?://[^\s)>\]\"']+")
_EMAIL_VERB_RE = re.compile(
    r"\b(send.*to|email|mail|reply|write\s+to)\b", re.IGNORECASE
)
_SEARCH_VERB_RE = re.compile(
    r"\b(search|google|find|look\s+up|research|investigate|browse)\b", re.IGNORECASE
)
_REASONING_VERB_RE = re.compile(
    r"\b("
    r"summari[sz]e|outline|draft|plan|decide|analy[sz]e|"
    r"synthesi[sz]e|compare|propose|review|explain"
    r")\b",
    re.IGNORECASE,
)


def classify_keywords(*, title: str, description: str, sub_input: dict) -> Decision:
    """Pure deterministic classifier. No LLM. Used as a fallback and as
    the unit-test surface."""
    haystack = f"{title}\n{description}\n{_dict_text(sub_input)}"

    # Explicit skill markers in input → trust them
    skill = (sub_input.get("skill") or "").strip()
    if skill in {"web.fetch", "web.search", "email.send"}:
        return "openclaw"
    if skill in {"reason", "summarise", "draft", "decide"}:
        return "hermes"

    # URL or web-action verbs → openclaw
    if _URL_RE.search(haystack) or _EMAIL_VERB_RE.search(haystack) or _SEARCH_VERB_RE.search(haystack):
        return "openclaw"

    # Reasoning verbs → hermes
    if _REASONING_VERB_RE.search(haystack):
        return "hermes"

    # Default: hermes (reasoning is the safer general-purpose default)
    return "hermes"


def _dict_text(d: dict) -> str:
    parts: list[str] = []
    for k, v in (d or {}).items():
        if isinstance(v, str):
            parts.append(f"{k}: {v}")
    return "\n".join(parts)


def llm_provider() -> str:
    if settings.nexos_api_key:
        return "nexos"
    if settings.anthropic_api_key:
        return "anthropic"
    if settings.openai_api_key:
        return "openai"
    return "none"


_SYSTEM_PROMPT = """You route subtasks to one of two specialist agents in the Blank Collar Agentic OS.

Choices (reply with EXACTLY one word, lowercase):
- openclaw — if the subtask needs a web action: fetching a URL, running a web search, sending an email, browser-clicking.
- hermes — if the subtask needs reasoning: summarising, drafting, analysing, deciding, planning.
- finish — if the subtask has already been handled or no further work is needed.

Reply with ONLY the single word. No explanation, no punctuation, no quotes."""


async def classify_with_llm(
    *, title: str, description: str, sub_input: dict
) -> Decision | None:
    """Returns the LLM's choice or None on any failure (caller falls
    back to keyword classification)."""
    provider = llm_provider()
    if provider == "none":
        return None

    user = (
        f"Title: {title}\n"
        f"Description: {description}\n"
        f"Input keys: {list((sub_input or {}).keys())}"
    )

    try:
        if provider in ("nexos", "openai"):
            from openai import AsyncOpenAI  # noqa: WPS433

            api_key = settings.nexos_api_key or settings.openai_api_key
            base_url = settings.nexos_base_url if provider == "nexos" else None
            client = AsyncOpenAI(api_key=api_key, base_url=base_url) if base_url else AsyncOpenAI(api_key=api_key)
            r = await client.chat.completions.create(
                model=settings.nexos_model if provider == "nexos" else "gpt-4o-mini",
                max_tokens=settings.classifier_max_tokens,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user},
                ],
            )
            content = (r.choices[0].message.content or "").strip().lower()
        else:  # anthropic
            from anthropic import AsyncAnthropic  # noqa: WPS433

            client = AsyncAnthropic(api_key=settings.anthropic_api_key)
            msg = await client.messages.create(
                model=settings.classifier_model,
                max_tokens=settings.classifier_max_tokens,
                system=_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user}],
            )
            content = "".join(
                getattr(b, "text", "") for b in msg.content
            ).strip().lower()
    except Exception as e:
        log.warning("classifier LLM call failed: %s", e)
        return None

    word = content.split()[0] if content else ""
    if word in ("hermes", "openclaw", "finish"):
        return word  # type: ignore[return-value]
    log.warning("classifier returned unexpected word: %r", content[:40])
    return None
