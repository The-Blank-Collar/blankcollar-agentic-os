"""Hermes — FastAPI agent adapter."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, HTTPException

from app import __kind__, __version__
from app.brain import brain
from app.config import require_runtime_config, settings
from app.llm import LLM, make_llm
from app.models import HealthResponse, RunRequest, RunStateResponse, RunStatus
from app.runner import schedule_run
from app.state import runs

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}',
)
log = logging.getLogger("hermes")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("hermes starting version=%s model=%s env=%s", __version__, settings.model, settings.env)
    # Boot guard — refuses to start without Portkey configured. Tests don't
    # run lifespan, so test-only FakeLLM use stays unaffected.
    require_runtime_config()
    llm: LLM = make_llm()
    app.state.llm = llm
    try:
        yield
    finally:
        log.info("hermes shutting down")
        for state in list(runs.values()):
            state.cancel_event.set()
            if state.task and not state.task.done():
                state.task.cancel()
        await brain.aclose()


app = FastAPI(
    title="hermes",
    version=__version__,
    description="Blank Collar — general-purpose workforce agent (adapter contract).",
    lifespan=lifespan,
)


@app.get("/", response_model=HealthResponse, tags=["health"])
@app.get("/healthz", response_model=HealthResponse, tags=["health"])
async def healthz() -> HealthResponse:
    llm: LLM = app.state.llm
    return HealthResponse(
        ok=True,
        version=__version__,
        kind=__kind__,
        model=settings.model,
        provider=llm.name,
    )


@app.post("/run", status_code=202, tags=["agent"])
async def post_run(req: RunRequest) -> dict[str, str]:
    rid = str(req.run_id)
    if rid in runs and runs[rid].status not in (RunStatus.cancelled, RunStatus.failed):
        # Idempotent re-dispatch: don't start a second run for the same id.
        return {"status": runs[rid].status.value, "run_id": rid}
    schedule_run(req, app.state.llm)
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
