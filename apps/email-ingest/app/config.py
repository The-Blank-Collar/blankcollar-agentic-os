"""Settings for the inbound email poller."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    env: str = Field(default="local", alias="ENV")
    log_level: str = Field(default="info", alias="LOG_LEVEL")

    # In-cluster URLs for downstream services
    paperclip_url: str = Field(default="http://paperclip:80", alias="PAPERCLIP_URL")
    gbrain_url: str = Field(default="http://gbrain:80", alias="GBRAIN_URL")

    # Default org slug — used to derive scope until real auth lands
    org_slug: str = Field(default="blankcollar-demo", alias="PAPERCLIP_DEFAULT_ORG_SLUG")

    # IMAP — Hostinger-managed mailbox for agent@blankcollar.ai
    imap_host: str = Field(default="", alias="IMAP_HOST")
    imap_port: int = Field(default=993, alias="IMAP_PORT")
    imap_user: str = Field(default="", alias="IMAP_USER")
    imap_password: str = Field(default="", alias="IMAP_PASSWORD")
    imap_folder: str = Field(default="INBOX", alias="IMAP_FOLDER")
    imap_use_ssl: bool = Field(default=True, alias="IMAP_USE_SSL")

    # Polling cadence
    poll_interval_s: int = Field(default=60, alias="EMAIL_POLL_INTERVAL_S")

    # Optional shared secret used by Paperclip's edge to authenticate this
    # service when it creates goals on a user's behalf. Empty = degrade
    # gracefully (single-tenant local mode).
    inbound_webhook_secret: str | None = Field(default=None, alias="INBOUND_EMAIL_WEBHOOK_SECRET")


settings = Settings()
