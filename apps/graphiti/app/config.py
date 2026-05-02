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
    # crashing.
    #
    # Portkey routing for graphiti-core is a deferred follow-up (sprint
    # 2.1.b.2) — the library constructs its own OpenAI client internally,
    # so wiring Portkey through requires either patching the upstream or
    # using OPENAI_BASE_URL pointed at Portkey's openai-compatible endpoint.
    # For now graphiti continues to use direct provider keys; once the
    # follow-up lands, OPENAI_API_KEY here will be replaced by the Portkey
    # virtual key for OpenAI-compatible models.
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    portkey_api_key: str | None = Field(default=None, alias="PORTKEY_API_KEY")
    portkey_virtual_key_anthropic: str | None = Field(
        default=None, alias="PORTKEY_VIRTUAL_KEY_ANTHROPIC"
    )
    portkey_virtual_key_openai: str | None = Field(
        default=None, alias="PORTKEY_VIRTUAL_KEY_OPENAI"
    )
    portkey_base_url: str = Field(
        default="https://api.portkey.ai/v1", alias="PORTKEY_BASE_URL"
    )
    llm_model: str = Field(default="gpt-4o-mini", alias="GRAPHITI_LLM_MODEL")
    embedding_model: str = Field(
        default="text-embedding-3-small", alias="GRAPHITI_EMBEDDING_MODEL"
    )


settings = Settings()
