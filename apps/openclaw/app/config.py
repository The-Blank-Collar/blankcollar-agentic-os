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

    # ----- Oxylabs AI Studio (web.search) -----
    # The Hostinger order includes Oxylabs Credits 10000.
    # When OXYLABS_API_KEY is unset, web.search falls back to a "DuckDuckGo
    # Instant Answer" path so the demo stays runnable without credits.
    oxylabs_api_key: str | None = Field(default=None, alias="OXYLABS_API_KEY")
    oxylabs_base_url: str = Field(
        default="https://api.aistudio.oxylabs.io",
        alias="OXYLABS_BASE_URL",
    )
    oxylabs_search_path: str = Field(default="/v1/search", alias="OXYLABS_SEARCH_PATH")
    oxylabs_default_results: int = Field(default=10, alias="OXYLABS_DEFAULT_RESULTS")
    oxylabs_request_timeout_s: float = Field(default=30.0, alias="OXYLABS_TIMEOUT_S")

    # ----- email.send (SMTP via the dedicated agent@blankcollar.ai mailbox) -----
    smtp_host: str = Field(default="", alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_user: str = Field(default="", alias="SMTP_USER")
    smtp_password: str = Field(default="", alias="SMTP_PASSWORD")
    smtp_from: str = Field(default="agent@blankcollar.ai", alias="SMTP_FROM")
    # STARTTLS on 587 by default; flip to True for SMTPS (465).
    smtp_use_tls: bool = Field(default=False, alias="SMTP_USE_TLS")
    smtp_timeout_s: float = Field(default=20.0, alias="SMTP_TIMEOUT_S")

    # ----- web.browse (Playwright + headless Chromium) -----
    browser_timeout_s: float = Field(default=30.0, alias="OPENCLAW_BROWSER_TIMEOUT_S")
    browser_viewport_w: int = Field(default=1280, alias="OPENCLAW_BROWSER_VIEWPORT_W")
    browser_viewport_h: int = Field(default=800, alias="OPENCLAW_BROWSER_VIEWPORT_H")
    browser_max_screenshot_bytes: int = Field(
        default=2_000_000, alias="OPENCLAW_BROWSER_MAX_SCREENSHOT_BYTES"
    )

    # ----- nango.invoke (proxy through self-hosted Nango to 400+ APIs) -----
    nango_url: str = Field(default="http://nango:3003", alias="NANGO_URL")
    nango_secret_key: str | None = Field(default=None, alias="NANGO_SECRET_KEY")
    nango_request_timeout_s: float = Field(default=30.0, alias="NANGO_REQUEST_TIMEOUT_S")


settings = Settings()
