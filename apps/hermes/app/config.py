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
    """Hard-fail at app startup if required env is missing.

    Called from main.py's lifespan. Tests do not run lifespan, so they can
    construct FakeLLM via make_llm() without hitting this guard.
    """
    missing: list[str] = []
    if not settings.portkey_api_key:
        missing.append("PORTKEY_API_KEY")
    if not settings.portkey_virtual_key_anthropic:
        missing.append("PORTKEY_VIRTUAL_KEY_ANTHROPIC")
    if missing:
        raise RuntimeError(
            "[hermes.config] required env var(s) not set: "
            + ", ".join(missing)
            + ". Get a Portkey key at https://app.portkey.ai/, create an "
            "Anthropic virtual key, and set both in .env. "
            "See docs/ENVIRONMENT.md."
        )
