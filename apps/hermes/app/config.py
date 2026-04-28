"""Settings for the Hermes adapter. Everything via env."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    env: str = Field(default="local", alias="ENV")
    log_level: str = Field(default="info", alias="LOG_LEVEL")

    # gbrain
    gbrain_url: str = Field(default="http://gbrain:80", alias="GBRAIN_URL")

    # LLM
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    model: str = Field(default="claude-sonnet-4-6", alias="HERMES_MODEL")
    max_tokens: int = Field(default=1024, alias="HERMES_MAX_TOKENS")

    # Budget per run (soft cap; hard cap applied when set above 0)
    max_recall_results: int = Field(default=8, alias="HERMES_MAX_RECALL")


settings = Settings()
