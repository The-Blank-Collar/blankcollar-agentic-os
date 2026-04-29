"""Wrapper around graphiti-core. Connects to Neo4j; lazy-loads the Graphiti
client only when an LLM is configured so the service can start (and serve
/healthz) even without API keys."""

from __future__ import annotations

import logging
from typing import Any

from app.config import settings
from app.models import Scope

log = logging.getLogger("graphiti.graph")


def _llm_provider() -> str:
    """Which LLM provider is configured. 'none' means /add will skip."""
    if settings.openai_api_key:
        return "openai"
    if settings.nexos_api_key:
        return "nexos"
    if settings.anthropic_api_key:
        return "anthropic"
    return "none"


class GraphitiWrapper:
    def __init__(self) -> None:
        self._client = None  # graphiti.Graphiti, lazy
        self._driver = None  # neo4j driver, lazy
        self._llm = _llm_provider()

    @property
    def llm_provider(self) -> str:
        return self._llm

    async def neo4j_ok(self) -> bool:
        """Cheap probe of the Neo4j backend for the healthcheck."""
        try:
            from neo4j import AsyncGraphDatabase  # noqa: WPS433

            if self._driver is None:
                self._driver = AsyncGraphDatabase.driver(
                    settings.neo4j_uri,
                    auth=(settings.neo4j_user, settings.neo4j_password),
                )
            async with self._driver.session() as session:
                result = await session.run("RETURN 1 AS ok")
                row = await result.single()
                return bool(row and row["ok"] == 1)
        except Exception as e:
            log.warning("neo4j probe failed: %s", e)
            return False

    async def close(self) -> None:
        if self._driver is not None:
            await self._driver.close()
            self._driver = None
        if self._client is not None:
            try:
                await self._client.close()
            except Exception:
                pass
            self._client = None

    def _client_or_none(self):
        """Return a Graphiti client if an LLM is configured, else None."""
        if self._llm == "none":
            return None
        if self._client is not None:
            return self._client
        try:
            # Imported lazily so the service can boot even when graphiti's
            # extra deps fail (rare but possible).
            from graphiti_core import Graphiti  # type: ignore

            self._client = Graphiti(
                settings.neo4j_uri,
                settings.neo4j_user,
                settings.neo4j_password,
            )
        except Exception as e:
            log.error("failed to construct Graphiti client: %s", e)
            return None
        return self._client

    @staticmethod
    def group_id_for(scope: Scope) -> str:
        """Stable per-(org, department, goal) string used to scope queries.

        Graphiti supports a `group_id` argument that partitions facts inside
        the same Neo4j instance — perfect for our role-scoped multi-org model.
        """
        parts = [str(scope.org_id)]
        if scope.department_id is not None:
            parts.append(f"dept:{scope.department_id}")
        if scope.goal_id is not None:
            parts.append(f"goal:{scope.goal_id}")
        return "|".join(parts)

    async def add_episode(
        self,
        *,
        name: str,
        body: str,
        scope: Scope,
        source_description: str = "gbrain",
        reference_time=None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Add a temporal episode. Returns a result dict; never raises on
        graphiti-internal errors so callers (gbrain) don't break the user-
        facing remember path."""
        client = self._client_or_none()
        if client is None:
            return {
                "skipped": True,
                "reason": "no_llm_configured",
                "episode_id": None,
                "nodes_added": 0,
                "edges_added": 0,
            }

        try:
            # graphiti-core's signature has shifted across versions; we keep
            # the call defensive and pass only commonly-supported args.
            from datetime import datetime, timezone  # noqa: WPS433

            kwargs: dict[str, Any] = {
                "name": name,
                "episode_body": body,
                "source_description": source_description,
                "reference_time": reference_time or datetime.now(timezone.utc),
                "group_id": self.group_id_for(scope),
            }
            result = await client.add_episode(**kwargs)
            # The result shape varies by version; normalise what we can.
            episode_id = getattr(result, "uuid", None) or getattr(result, "episode_uuid", None)
            nodes_added = len(getattr(result, "nodes", []) or [])
            edges_added = len(getattr(result, "edges", []) or [])
            return {
                "skipped": False,
                "reason": None,
                "episode_id": str(episode_id) if episode_id else None,
                "nodes_added": nodes_added,
                "edges_added": edges_added,
            }
        except Exception as e:
            log.exception("graphiti add_episode failed")
            return {
                "skipped": True,
                "reason": f"graphiti_error: {e.__class__.__name__}",
                "episode_id": None,
                "nodes_added": 0,
                "edges_added": 0,
            }

    async def search(
        self, *, query: str, scope: Scope, k: int = 10
    ) -> list[dict[str, Any]]:
        client = self._client_or_none()
        if client is None:
            return []
        try:
            results = await client.search(
                query=query,
                group_ids=[self.group_id_for(scope)],
                num_results=k,
            )
            hits: list[dict[str, Any]] = []
            for r in results or []:
                hits.append(
                    {
                        "fact": getattr(r, "fact", str(r)),
                        "score": float(getattr(r, "score", 0.0) or 0.0),
                        "source_episode_id": getattr(r, "source_episode_id", None),
                        "valid_from": getattr(r, "valid_at", None),
                        "valid_to": getattr(r, "invalid_at", None),
                    }
                )
            return hits
        except Exception as e:
            log.warning("graphiti search failed: %s", e)
            return []


graph = GraphitiWrapper()
