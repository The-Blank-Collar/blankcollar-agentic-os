"""Graphiti — temporal knowledge graph wrapper for Blank Collar Agentic OS."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import __version__
from app.config import settings
from app.graph import graph
from app.models import (
    AddRequest,
    AddResponse,
    HealthResponse,
    SearchHit,
    SearchRequest,
)

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
)
log = logging.getLogger("graphiti")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info(
        "graphiti starting version=%s neo4j=%s llm=%s",
        __version__, settings.neo4j_uri, graph.llm_provider,
    )
    if graph.llm_provider == "none":
        log.warning(
            "no LLM provider configured — /add will return skipped=true. "
            "Set OPENAI_API_KEY (preferred) or ANTHROPIC_API_KEY to enable. "
            "Portkey routing for graphiti-core is a sprint 2.1.b.2 follow-up."
        )
    try:
        yield
    finally:
        log.info("graphiti shutting down")
        await graph.close()


app = FastAPI(
    title="graphiti",
    version=__version__,
    description="Temporal knowledge graph for Blank Collar — wraps graphiti-core with Neo4j backend.",
    lifespan=lifespan,
)


@app.get("/", response_model=HealthResponse, tags=["health"])
@app.get("/healthz", response_model=HealthResponse, tags=["health"])
async def healthz() -> HealthResponse:
    backend_ok = await graph.neo4j_ok()
    return HealthResponse(
        ok=backend_ok,
        version=__version__,
        backend="neo4j",
        backend_ok=backend_ok,
        llm_provider=graph.llm_provider,
    )


@app.post("/add", response_model=AddResponse, tags=["graph"])
async def add_episode(req: AddRequest) -> AddResponse:
    result = await graph.add_episode(
        name=req.name,
        body=req.body,
        scope=req.scope,
        source_description=req.source,
        reference_time=req.occurred_at,
        metadata=req.metadata,
    )
    return AddResponse(**result)


@app.post("/search", response_model=list[SearchHit], tags=["graph"])
async def search(req: SearchRequest) -> list[SearchHit]:
    hits = await graph.search(query=req.query, scope=req.scope, k=req.k)
    return [SearchHit(**h) for h in hits]
