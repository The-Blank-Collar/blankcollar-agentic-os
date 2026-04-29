"""Settings for the Graphiti wrapper. All env-driven."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    env: str = Field(default="local", alias="ENV")
    log_level: str = Field(default="info", alias="LOG_LEVEL")

    # Neo4j (the temporal graph backend)
    neo4j_uri: str = Field(default="bolt://neo4j:7687", alias="NEO4J_URI")
    neo4j_user: str = Field(default="neo4j", alias="NEO4J_USER")
    neo4j_password: str = Field(default="password", alias="NEO4J_PASSWORD")

    # LLM provider — graphiti uses an LLM to extract entities + relationships
    # from each ingested episode. Without a key we degrade gracefully:
    # /add returns {skipped: true, reason: "no_llm_configured"} instead of
    # crashing. Set OPENAI_API_KEY (preferred) or ANTHROPIC_API_KEY to enable.
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    nexos_api_key: str | None = Field(default=None, alias="NEXOS_API_KEY")
    nexos_base_url: str = Field(default="https://api.nexos.ai/v1", alias="NEXOS_BASE_URL")
    llm_model: str = Field(default="gpt-4o-mini", alias="GRAPHITI_LLM_MODEL")
    embedding_model: str = Field(
        default="text-embedding-3-small", alias="GRAPHITI_EMBEDDING_MODEL"
    )


settings = Settings()
