"""FastAPI app — gbrain memory service."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import __version__
from app.config import settings
from app.db import db
from app.embeddings import Embedder, make_embedder
from app.memory import forget, recall, remember
from app.models import (
    ForgetRequest,
    ForgetResponse,
    HealthResponse,
    RecallHit,
    RecallRequest,
    RememberRequest,
    RememberResponse,
)
from app.vectors import vectors

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
)
log = logging.getLogger("gbrain")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info(
        "gbrain starting version=%s env=%s embed_model=%s embed_dim=%d",
        __version__,
        settings.env,
        settings.embed_model,
        settings.embed_dim,
    )
    await db.connect()
    await vectors.connect()
    embedder: Embedder = make_embedder()
    app.state.embedder = embedder
    try:
        yield
    finally:
        log.info("gbrain shutting down")
        if hasattr(embedder, "aclose"):
            await embedder.aclose()  # type: ignore[func-returns-value]
        await vectors.close()
        await db.close()


app = FastAPI(
    title="gbrain",
    description="Blank Collar Agentic OS — memory layer (semantic + episodic + facts, role-scoped).",
    version=__version__,
    lifespan=lifespan,
)


# ---------- routes ----------------------------------------------------------


@app.get("/", response_model=HealthResponse, tags=["health"])
@app.get("/healthz", response_model=HealthResponse, tags=["health"])
async def healthz() -> HealthResponse:
    embedder: Embedder = app.state.embedder
    return HealthResponse(
        ok=True,
        version=__version__,
        embed_model=settings.embed_model,
        embed_dim=settings.embed_dim,
        embed_provider=embedder.name,
    )


@app.post("/remember", response_model=RememberResponse, tags=["memory"])
async def post_remember(req: RememberRequest) -> RememberResponse:
    return await remember(req, app.state.embedder)


@app.post("/recall", response_model=list[RecallHit], tags=["memory"])
async def post_recall(req: RecallRequest) -> list[RecallHit]:
    return await recall(req, app.state.embedder)


@app.post("/forget", response_model=ForgetResponse, tags=["memory"])
async def post_forget(req: ForgetRequest) -> ForgetResponse:
    return await forget(req)
