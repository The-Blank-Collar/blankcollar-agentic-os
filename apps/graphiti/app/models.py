"""Wire format. Mirrors gbrain's scope model so the bridge has minimal friction."""

from __future__ import annotations

from datetime import datetime
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


# ---------- /add -----------------------------------------------------------


class AddRequest(BaseModel):
    """Add a temporal episode to the knowledge graph."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1)
    scope: Scope
    occurred_at: datetime | None = None
    source: str = Field(default="gbrain", max_length=50)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AddResponse(BaseModel):
    skipped: bool = False
    reason: str | None = None
    episode_id: str | None = None
    nodes_added: int = 0
    edges_added: int = 0


# ---------- /search --------------------------------------------------------


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1)
    scope: Scope
    k: int = Field(default=10, ge=1, le=50)


class SearchHit(BaseModel):
    fact: str
    score: float
    source_episode_id: str | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None


# ---------- /healthz -------------------------------------------------------


class HealthResponse(BaseModel):
    ok: bool
    version: str
    backend: str
    backend_ok: bool
    llm_provider: str
