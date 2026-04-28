"""Settings for the OpenClaw adapter."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    env: str = Field(default="local", alias="ENV")
    log_level: str = Field(default="info", alias="LOG_LEVEL")

    gbrain_url: str = Field(default="http://gbrain:80", alias="GBRAIN_URL")

    # Politeness controls for web.fetch
    fetch_timeout_s: float = Field(default=10.0, alias="OPENCLAW_FETCH_TIMEOUT_S")
    fetch_max_bytes: int = Field(default=1_500_000, alias="OPENCLAW_FETCH_MAX_BYTES")
    fetch_user_agent: str = Field(
        default="BlankCollar-OpenClaw/0.1 (+https://www.blankcollar.ai)",
        alias="OPENCLAW_USER_AGENT",
    )
    # Cap how much extracted text we hand back to keep payloads sane.
    text_excerpt_chars: int = Field(default=8_000, alias="OPENCLAW_TEXT_EXCERPT_CHARS")


settings = Settings()
