"""LangGraph dispatcher — FastAPI agent adapter."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, HTTPException

from app import __kind__, __version__
from app.adapter_client import downstream_health
from app.classifier import llm_provider
from app.config import settings
from app.models import HealthResponse, RunRequest, RunStateResponse, RunStatus
from app.runner import schedule_run
from app.state import runs

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
)
log = logging.getLogger("langgraph")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info(
        "langgraph starting version=%s classifier=%s",
        __version__, llm_provider(),
    )
    if llm_provider() == "none":
        log.warning(
            "no LLM provider configured — classifier falls back to keyword rules. "
            "Set NEXOS_API_KEY (preferred) / ANTHROPIC_API_KEY / OPENAI_API_KEY for smarter routing."
        )
    try:
        yield
    finally:
        log.info("langgraph shutting down")
        for st in list(runs.values()):
            st.cancel_event.set()
            if st.task and not st.task.done():
                st.task.cancel()


app = FastAPI(
    title="langgraph",
    version=__version__,
    description="LangGraph dispatcher — orchestrates Hermes + OpenClaw via the agent adapter contract.",
    lifespan=lifespan,
)


@app.get("/", response_model=HealthResponse, tags=["health"])
@app.get("/healthz", response_model=HealthResponse, tags=["health"])
async def healthz() -> HealthResponse:
    hermes_ok, openclaw_ok, gbrain_ok = await asyncio.gather(
        downstream_health(settings.hermes_url),
        downstream_health(settings.openclaw_url),
        downstream_health(settings.gbrain_url),
    )
    return HealthResponse(
        ok=True,
        version=__version__,
        kind=__kind__,
        classifier_provider=llm_provider(),
        downstream={
            "hermes": hermes_ok,
            "openclaw": openclaw_ok,
            "gbrain": gbrain_ok,
        },
    )


@app.post("/run", status_code=202, tags=["agent"])
async def post_run(req: RunRequest) -> dict[str, str]:
    rid = str(req.run_id)
    if rid in runs and runs[rid].status not in (RunStatus.cancelled, RunStatus.failed):
        return {"status": runs[rid].status.value, "run_id": rid}
    schedule_run(req)
    return {"status": "running", "run_id": rid}


@app.get("/run/{run_id}", response_model=RunStateResponse, tags=["agent"])
async def get_run(run_id: UUID) -> RunStateResponse:
    state = runs.get(str(run_id))
    if state is None:
        raise HTTPException(status_code=404, detail="run not found")
    return state.to_response()


@app.post("/run/{run_id}/cancel", response_model=RunStateResponse, tags=["agent"])
async def cancel_run(run_id: UUID) -> RunStateResponse:
    state = runs.get(str(run_id))
    if state is None:
        raise HTTPException(status_code=404, detail="run not found")
    state.cancel_event.set()
    if state.task and not state.task.done():
        state.task.cancel()
    state.mark_cancelled()
    return state.to_response()
