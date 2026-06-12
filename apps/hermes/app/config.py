"""Settings for the Hermes adapter. Everything via env."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    env: str = Field(default="local", alias="ENV")
    log_level: str = Field(default="info", alias="LOG_LEVEL")

    # gbrain
    gbrain_url: str = Field(default="http://gbrain:80", alias="GBRAIN_URL")

    # AI gateway — Portkey routes every LLM call through one observable proxy.
    # Required at boot in production; the test suite uses FakeLLM when the keys
    # are unset (see make_llm()). Anthropic credentials live in the Portkey
    # dashboard, referenced by the virtual key.
    portkey_api_key: str | None = Field(default=None, alias="PORTKEY_API_KEY")
    portkey_virtual_key_anthropic: str | None = Field(
        default=None, alias="PORTKEY_VIRTUAL_KEY_ANTHROPIC"
    )
    # Optional — Portkey can also route to OpenRouter for models Anthropic
    # doesn't host. Hermes' main reasoning loop stays on Anthropic; this
    # field exists so per-task overrides become possible without an env churn.
    portkey_virtual_key_openrouter: str | None = Field(
        default=None, alias="PORTKEY_VIRTUAL_KEY_OPENROUTER"
    )
    portkey_base_url: str = Field(
        default="https://api.portkey.ai/v1", alias="PORTKEY_BASE_URL"
    )

    # Model + token budget for the agent loop.
    model: str = Field(default="claude-sonnet-4-6", alias="HERMES_MODEL")
    max_tokens: int = Field(default=1024, alias="HERMES_MAX_TOKENS")

    # Budget per run (soft cap; hard cap applied when set above 0)
    max_recall_results: int = Field(default=8, alias="HERMES_MAX_RECALL")

    # Brand Foundation (design.md). Falls back to no block if file missing.
    brand_dir: str = Field(default="/app/brand", alias="BRAND_DIR")
    brand_name: str = Field(default="blankcollar", alias="BRAND_NAME")


settings = Settings()


def require_runtime_config() -> None:
    """Soft-validate at app startup; warn loudly without throwing.

    OSS-friendly: a fresh clone with no Portkey credentials still boots —
    `make_llm()` returns the deterministic FakeLLM and Hermes serves
    canned but valid agent responses. Set PORTKEY_API_KEY (and either
    a `@workspace/model` reference in HERMES_MODEL or
    PORTKEY_VIRTUAL_KEY_ANTHROPIC for legacy routing) to switch to
    real Claude.

    Called from main.py's lifespan. Tests do not run lifespan, so they
    construct FakeLLM via make_llm() without hitting this path.
    """
    import logging

    log = logging.getLogger("hermes.config")
    if not settings.portkey_api_key:
        log.warning(
            "[hermes.config] PORTKEY_API_KEY is unset — running in FakeLLM mode. "
            "Hermes returns canned responses until you set a Portkey key."
        )
        return
    using_model_catalog = settings.model.startswith("@")
    if not using_model_catalog and not settings.portkey_virtual_key_anthropic:
        log.warning(
            "[hermes.config] PORTKEY_API_KEY is set but PORTKEY_VIRTUAL_KEY_ANTHROPIC "
            "is missing AND HERMES_MODEL is a plain name (legacy routing). LLM calls "
            "will 401 until you either set the virtual key or switch HERMES_MODEL "
            "to a `@workspace/model` reference."
        )
