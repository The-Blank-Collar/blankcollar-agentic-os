"""Thin Postgres pool around asyncpg + queries gbrain owns."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import asyncpg

from app.config import settings


class DB:
    def __init__(self) -> None:
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=1,
            max_size=8,
            command_timeout=10,
        )

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    @property
    def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("DB pool not initialized — call connect() first")
        return self._pool

    # -- queries ------------------------------------------------------------

    async def get_org_slug(self, org_id: UUID) -> str | None:
        row = await self.pool.fetchrow(
            "SELECT slug FROM core.organization WHERE id = $1",
            org_id,
        )
        return row["slug"] if row else None

    async def insert_memory(
        self,
        *,
        memory_id: UUID,
        org_id: UUID,
        department_id: UUID | None,
        goal_id: UUID | None,
        kind: str,
        title: str | None,
        content: str,
        vector_ref: dict[str, Any] | None,
        visible_to: list[str],
        metadata: dict[str, Any],
    ) -> None:
        await self.pool.execute(
            """
            INSERT INTO brain.memory (
              id, org_id, department_id, goal_id, kind,
              title, content, vector_ref, visible_to, metadata
            )
            VALUES ($1, $2, $3, $4, $5::brain.memory_kind,
                    $6, $7, $8::jsonb, $9::core.role_kind[], $10::jsonb)
            """,
            memory_id,
            org_id,
            department_id,
            goal_id,
            kind,
            title,
            content,
            json.dumps(vector_ref) if vector_ref is not None else None,
            visible_to,
            json.dumps(metadata),
        )

    async def get_memory_for_forget(self, memory_id: UUID, org_id: UUID) -> dict[str, Any] | None:
        row = await self.pool.fetchrow(
            """
            SELECT id, org_id, kind, vector_ref
            FROM brain.memory
            WHERE id = $1 AND org_id = $2
            """,
            memory_id,
            org_id,
        )
        if row is None:
            return None
        ref = row["vector_ref"]
        if isinstance(ref, str):
            ref = json.loads(ref)
        return {"id": row["id"], "org_id": row["org_id"], "kind": row["kind"], "vector_ref": ref}

    async def delete_memory(self, memory_id: UUID, org_id: UUID) -> None:
        await self.pool.execute(
            "DELETE FROM brain.memory WHERE id = $1 AND org_id = $2",
            memory_id,
            org_id,
        )

    async def get_memories_by_ids(
        self, ids: list[UUID], org_id: UUID
    ) -> dict[UUID, dict[str, Any]]:
        if not ids:
            return {}
        rows = await self.pool.fetch(
            """
            SELECT id, kind, title, content, metadata
            FROM brain.memory
            WHERE org_id = $1 AND id = ANY($2::uuid[])
            """,
            org_id,
            ids,
        )
        out: dict[UUID, dict[str, Any]] = {}
        for r in rows:
            md = r["metadata"]
            if isinstance(md, str):
                md = json.loads(md)
            out[r["id"]] = {
                "kind": r["kind"],
                "title": r["title"],
                "content": r["content"],
                "metadata": md or {},
            }
        return out

    async def write_audit(
        self,
        *,
        org_id: UUID,
        actor_role: str,
        action: str,
        target_type: str,
        target_id: str,
        metadata: dict[str, Any],
    ) -> None:
        await self.pool.execute(
            """
            INSERT INTO core.audit_log
              (org_id, actor_role, action, target_type, target_id, metadata)
            VALUES ($1, $2::core.role_kind, $3, $4, $5, $6::jsonb)
            """,
            org_id,
            actor_role,
            action,
            target_type,
            target_id,
            json.dumps(metadata),
        )


db = DB()
