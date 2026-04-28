"""Wire formats. Match docs/API.md (Agent Adapter Contract)."""

from __future__ import annotations

from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class RoleKind(str, Enum):
    owner = "owner"
    department_lead = "department_lead"
    team_member = "team_member"
    auditor = "auditor"
    agent = "agent"


class Scope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    org_id: UUID
    department_id: UUID | None = None
    goal_id: UUID | None = None
    role: RoleKind


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    goal_id: UUID
    run_id: UUID
    input: dict[str, Any] = Field(default_factory=dict)
    scope: Scope


class RunStatus(str, Enum):
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class RunStateResponse(BaseModel):
    status: RunStatus
    output: dict[str, Any] | None = None
    error: str | None = None
    started_at: str | None = None
    finished_at: str | None = None


class HealthResponse(BaseModel):
    ok: bool
    version: str
    kind: str
    model: str
    provider: str
