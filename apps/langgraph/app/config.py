"""Settings for the LangGraph dispatcher. Env-driven."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    env: str = Field(default="local", alias="ENV")
    log_level: str = Field(default="info", alias="LOG_LEVEL")

    # Downstream services (in-cluster URLs)
    hermes_url: str = Field(default="http://hermes:80", alias="HERMES_URL")
    openclaw_url: str = Field(default="http://openclaw:80", alias="OPENCLAW_URL")
    gbrain_url: str = Field(default="http://gbrain:80", alias="GBRAIN_URL")

    # AI gateway — Portkey routes every LLM call through one observable proxy.
    # Required at boot in production; tests fall back to keyword-only routing
    # when keys are unset (see classifier.llm_provider()).
    portkey_api_key: str | None = Field(default=None, alias="PORTKEY_API_KEY")
    portkey_virtual_key_anthropic: str | None = Field(
        default=None, alias="PORTKEY_VIRTUAL_KEY_ANTHROPIC"
    )
    portkey_base_url: str = Field(
        default="https://api.portkey.ai/v1", alias="PORTKEY_BASE_URL"
    )

    classifier_model: str = Field(default="claude-sonnet-4-6", alias="LANGGRAPH_CLASSIFIER_MODEL")
    classifier_max_tokens: int = Field(default=200, alias="LANGGRAPH_CLASSIFIER_MAX_TOKENS")

    # Per-step ceiling: how many cycles can the graph run before forcing finish.
    max_cycles: int = Field(default=4, alias="LANGGRAPH_MAX_CYCLES")
    poll_downstream_interval_s: float = Field(default=0.5, alias="LANGGRAPH_POLL_INTERVAL_S")
    poll_downstream_timeout_s: float = Field(default=180.0, alias="LANGGRAPH_POLL_TIMEOUT_S")


settings = Settings()


def require_runtime_config() -> None:
    """Hard-fail at app startup if Portkey is not configured.

    Called from main.py's lifespan. Tests do not run lifespan, so they can
    exercise classifier.classify_with_llm() returning None when the keys
    are unset (the keyword fallback path).
    """
    missing: list[str] = []
    if not settings.portkey_api_key:
        missing.append("PORTKEY_API_KEY")
    if not settings.portkey_virtual_key_anthropic:
        missing.append("PORTKEY_VIRTUAL_KEY_ANTHROPIC")
    if missing:
        raise RuntimeError(
            "[langgraph.config] required env var(s) not set: "
            + ", ".join(missing)
            + ". Get a Portkey key at https://app.portkey.ai/, create an "
            "Anthropic virtual key, and set both in .env. "
            "See docs/ENVIRONMENT.md."
        )
