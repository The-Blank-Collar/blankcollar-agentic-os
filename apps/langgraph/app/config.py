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

    # LLM provider precedence: Nexos > Anthropic > OpenAI > Fake.
    # Used for the dispatcher's classifier node (route-to-agent decision).
    nexos_api_key: str | None = Field(default=None, alias="NEXOS_API_KEY")
    nexos_base_url: str = Field(default="https://api.nexos.ai/v1", alias="NEXOS_BASE_URL")
    nexos_model: str = Field(default="claude-sonnet", alias="NEXOS_MODEL")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")

    classifier_model: str = Field(default="claude-sonnet-4-6", alias="LANGGRAPH_CLASSIFIER_MODEL")
    classifier_max_tokens: int = Field(default=200, alias="LANGGRAPH_CLASSIFIER_MAX_TOKENS")

    # Per-step ceiling: how many cycles can the graph run before forcing finish.
    max_cycles: int = Field(default=4, alias="LANGGRAPH_MAX_CYCLES")
    poll_downstream_interval_s: float = Field(default=0.5, alias="LANGGRAPH_POLL_INTERVAL_S")
    poll_downstream_timeout_s: float = Field(default=180.0, alias="LANGGRAPH_POLL_TIMEOUT_S")


settings = Settings()
