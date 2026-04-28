"""In-memory run state. Phase 4 will persist; v0 holds in process."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from app.models import RunStateResponse, RunStatus


class RunState:
    def __init__(self) -> None:
        self.status: RunStatus = RunStatus.running
        self.output: dict[str, Any] | None = None
        self.error: str | None = None
        self.started_at: datetime = datetime.now(timezone.utc)
        self.finished_at: datetime | None = None
        self.cancel_event: asyncio.Event = asyncio.Event()
        self.task: asyncio.Task[None] | None = None

    def to_response(self) -> RunStateResponse:
        return RunStateResponse(
            status=self.status,
            output=self.output,
            error=self.error,
            started_at=self.started_at.isoformat(),
            finished_at=self.finished_at.isoformat() if self.finished_at else None,
        )

    def mark_succeeded(self, output: dict[str, Any]) -> None:
        self.status = RunStatus.succeeded
        self.output = output
        self.finished_at = datetime.now(timezone.utc)

    def mark_failed(self, error: str) -> None:
        self.status = RunStatus.failed
        self.error = error
        self.finished_at = datetime.now(timezone.utc)

    def mark_cancelled(self) -> None:
        if self.status not in (RunStatus.succeeded, RunStatus.failed):
            self.status = RunStatus.cancelled
            self.finished_at = datetime.now(timezone.utc)


# Process-local map keyed by run_id (string).
runs: dict[str, RunState] = {}
