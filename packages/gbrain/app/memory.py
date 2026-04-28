"""Business logic: remember / recall / forget."""

from __future__ import annotations

import logging
from uuid import UUID, uuid4

from fastapi import HTTPException

from app.db import db
from app.embeddings import Embedder
from app.models import (
    ForgetRequest,
    ForgetResponse,
    RecallHit,
    RecallRequest,
    RememberRequest,
    RememberResponse,
)
from app.scope import build_qdrant_filter, can_role_see, effective_visible_to
from app.vectors import collection_name, vectors

log = logging.getLogger("gbrain.memory")


async def _resolve_org_slug(org_id: UUID) -> str:
    slug = await db.get_org_slug(org_id)
    if slug is None:
        raise HTTPException(status_code=404, detail="org not found")
    return slug


async def remember(req: RememberRequest, embedder: Embedder) -> RememberResponse:
    org_slug = await _resolve_org_slug(req.scope.org_id)

    visible = effective_visible_to(req.visible_to)
    visible_strs = [r.value for r in visible]

    memory_id = uuid4()
    point_id = str(memory_id)
    coll = collection_name(org_slug, req.kind.value)

    vector = await embedder.embed(req.content)

    payload = {
        "memory_id": str(memory_id),
        "org_id": str(req.scope.org_id),
        "department_id": str(req.scope.department_id) if req.scope.department_id else None,
        "goal_id": str(req.scope.goal_id) if req.scope.goal_id else None,
        "kind": req.kind.value,
        "visible_to": visible_strs,
    }

    await vectors.upsert(collection=coll, point_id=point_id, vector=vector, payload=payload)

    await db.insert_memory(
        memory_id=memory_id,
        org_id=req.scope.org_id,
        department_id=req.scope.department_id,
        goal_id=req.scope.goal_id,
        kind=req.kind.value,
        title=req.title,
        content=req.content,
        vector_ref={"collection": coll, "point_id": point_id},
        visible_to=visible_strs,
        metadata=req.metadata,
    )

    await db.write_audit(
        org_id=req.scope.org_id,
        actor_role=req.scope.role.value,
        action="memory.remember",
        target_type="memory",
        target_id=str(memory_id),
        metadata={
            "kind": req.kind.value,
            "department_id": str(req.scope.department_id) if req.scope.department_id else None,
            "goal_id": str(req.scope.goal_id) if req.scope.goal_id else None,
        },
    )

    return RememberResponse(memory_id=memory_id)


async def recall(req: RecallRequest, embedder: Embedder) -> list[RecallHit]:
    org_slug = await _resolve_org_slug(req.scope.org_id)

    kinds = [k.value for k in req.kinds] if req.kinds else ["fact", "episode", "document", "conversation"]
    flt = build_qdrant_filter(req.scope)

    vec = await embedder.embed(req.query)

    # Search each relevant collection in parallel-ish; for v0 just sequentially.
    all_points = []
    for kind in kinds:
        coll = collection_name(org_slug, kind)
        try:
            points = await vectors.search(
                collection=coll,
                vector=vec,
                flt=flt,
                limit=req.k,
                score_threshold=req.min_score,
            )
        except Exception as e:
            # If a collection doesn't exist yet, treat as no hits for that kind.
            log.debug("search failed on %s: %s", coll, e)
            continue
        for p in points:
            all_points.append(p)

    all_points.sort(key=lambda p: p.score, reverse=True)
    top = all_points[: req.k]

    if not top:
        return []

    # Hydrate from Postgres in one round-trip.
    ids = [UUID(str(p.id)) for p in top]
    rows = await db.get_memories_by_ids(ids, req.scope.org_id)

    hits: list[RecallHit] = []
    for p in top:
        mid = UUID(str(p.id))
        row = rows.get(mid)
        if row is None:
            continue
        # Re-assert role visibility from the canonical row, not the payload.
        # (Defense in depth — if the payload drifts, the row wins.)
        # Note: row doesn't carry visible_to here (we keep the query small);
        # the Qdrant filter already enforced this. If you tighten further,
        # join visible_to into get_memories_by_ids.
        hits.append(
            RecallHit(
                memory_id=mid,
                score=float(p.score),
                content=row["content"],
                kind=row["kind"],
                title=row["title"],
                metadata=row["metadata"],
            )
        )
    return hits


async def forget(req: ForgetRequest) -> ForgetResponse:
    row = await db.get_memory_for_forget(req.memory_id, req.scope.org_id)
    if row is None:
        raise HTTPException(status_code=404, detail="memory not found")

    ref = row.get("vector_ref") or {}
    if isinstance(ref, dict) and ref.get("collection") and ref.get("point_id"):
        await vectors.delete_point(ref["collection"], ref["point_id"])

    await db.delete_memory(req.memory_id, req.scope.org_id)

    await db.write_audit(
        org_id=req.scope.org_id,
        actor_role=req.scope.role.value,
        action="memory.forget",
        target_type="memory",
        target_id=str(req.memory_id),
        metadata={"reason": req.reason},
    )

    return ForgetResponse(ok=True)


# Defensive helper — referenced from routes for symmetry / future use.
__all__ = ["remember", "recall", "forget", "can_role_see"]
