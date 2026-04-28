"""Qdrant client wrapper. Owns collection naming and lazy bootstrap."""

from __future__ import annotations

import asyncio
from typing import Any

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qm

from app.config import settings

# Collections per (org_slug, kind). See docs/SCHEMA.md.
_collection_locks: dict[str, asyncio.Lock] = {}
_collections_seen: set[str] = set()


def collection_name(org_slug: str, kind: str) -> str:
    return f"{org_slug}__{kind}"


class Vectors:
    def __init__(self) -> None:
        self._client: AsyncQdrantClient | None = None

    async def connect(self) -> None:
        self._client = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key or None,
            prefer_grpc=False,
        )

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None

    @property
    def client(self) -> AsyncQdrantClient:
        if self._client is None:
            raise RuntimeError("Qdrant client not initialized — call connect() first")
        return self._client

    async def ensure_collection(self, name: str) -> None:
        if name in _collections_seen:
            return
        lock = _collection_locks.setdefault(name, asyncio.Lock())
        async with lock:
            if name in _collections_seen:
                return
            existing = await self.client.get_collections()
            if any(c.name == name for c in existing.collections):
                _collections_seen.add(name)
                return
            await self.client.create_collection(
                collection_name=name,
                vectors_config=qm.VectorParams(
                    size=settings.embed_dim,
                    distance=qm.Distance.COSINE,
                ),
            )
            # Indexing the most-filtered fields up front keeps recall fast.
            for field, schema in (
                ("org_id", qm.PayloadSchemaType.KEYWORD),
                ("department_id", qm.PayloadSchemaType.KEYWORD),
                ("goal_id", qm.PayloadSchemaType.KEYWORD),
                ("visible_to", qm.PayloadSchemaType.KEYWORD),
            ):
                try:
                    await self.client.create_payload_index(
                        collection_name=name,
                        field_name=field,
                        field_schema=schema,
                    )
                except Exception:
                    # Index may already exist — non-fatal.
                    pass
            _collections_seen.add(name)

    async def upsert(
        self,
        *,
        collection: str,
        point_id: str,
        vector: list[float],
        payload: dict[str, Any],
    ) -> None:
        await self.ensure_collection(collection)
        await self.client.upsert(
            collection_name=collection,
            points=[
                qm.PointStruct(id=point_id, vector=vector, payload=payload),
            ],
        )

    async def search(
        self,
        *,
        collection: str,
        vector: list[float],
        flt: qm.Filter,
        limit: int,
        score_threshold: float | None = None,
    ) -> list[qm.ScoredPoint]:
        await self.ensure_collection(collection)
        return await self.client.search(
            collection_name=collection,
            query_vector=vector,
            query_filter=flt,
            limit=limit,
            score_threshold=score_threshold,
        )

    async def delete_point(self, collection: str, point_id: str) -> None:
        try:
            await self.client.delete(
                collection_name=collection,
                points_selector=qm.PointIdsList(points=[point_id]),
            )
        except Exception:
            # Collection might not exist if memory was written before we created it. Non-fatal.
            pass


vectors = Vectors()
