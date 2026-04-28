"""OpenClaw — FastAPI agent adapter."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, HTTPException

from app import __kind__, __version__
from app.brain import brain
from app.config import settings
from app.models import HealthResponse, RunRequest, RunStateResponse, RunStatus
from app.runner import SUPPORTED_SKILLS, schedule_run
from app.state import runs

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
)
log = logging.getLogger("openclaw")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("openclaw starting version=%s skills=%s env=%s", __version__, ",".join(SUPPORTED_SKILLS), settings.env)
    try:
        yield
    finally:
        log.info("openclaw shutting down")
        for state in list(runs.values()):
            state.cancel_event.set()
            if state.task and not state.task.done():
                state.task.cancel()
        await brain.aclose()


app = FastAPI(
    title="openclaw",
    version=__version__,
    description="Blank Collar — tool / web-action agent (adapter contract).",
    lifespan=lifespan,
)


@app.get("/", response_model=HealthResponse, tags=["health"])
@app.get("/healthz", response_model=HealthResponse, tags=["health"])
async def healthz() -> HealthResponse:
    return HealthResponse(
        ok=True,
        version=__version__,
        kind=__kind__,
        skills=list(SUPPORTED_SKILLS),
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
