"""Settings loaded from the environment. Mirrors `.env.example`."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    # --- Identity / logging -------------------------------------------------
    project_name: str = Field(default="blankcollar", alias="PROJECT_NAME")
    env: str = Field(default="local", alias="ENV")
    log_level: str = Field(default="info", alias="LOG_LEVEL")

    # --- Postgres -----------------------------------------------------------
    database_url: str = Field(
        default="postgresql://postgres:postgres@postgres:5432/blankcollar",
        alias="DATABASE_URL",
    )

    # --- Qdrant -------------------------------------------------------------
    qdrant_url: str = Field(default="http://qdrant:6333", alias="QDRANT_URL")
    qdrant_api_key: str | None = Field(default=None, alias="QDRANT_API_KEY")

    # --- Embeddings ---------------------------------------------------------
    embed_model: str = Field(default="text-embedding-3-small", alias="GBRAIN_EMBED_MODEL")
    embed_dim: int = Field(default=1536, alias="GBRAIN_EMBED_DIM")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")

    # --- Graphiti bridge ----------------------------------------------------
    # When set, gbrain best-effort POSTs every /remember to graphiti's /add
    # so the temporal graph stays in sync. Empty value disables the bridge.
    graphiti_url: str = Field(default="", alias="GRAPHITI_URL")


settings = Settings()
