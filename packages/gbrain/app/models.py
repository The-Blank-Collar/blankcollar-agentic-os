"""Pydantic models. Wire formats match `docs/API.md` exactly."""

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


class MemoryKind(str, Enum):
    fact = "fact"
    episode = "episode"
    document = "document"
    conversation = "conversation"


class Scope(BaseModel):
    """Carried on every read and every write. The single most important shape in the system."""

    model_config = ConfigDict(extra="forbid")

    org_id: UUID
    department_id: UUID | None = None
    goal_id: UUID | None = None
    role: RoleKind


# ---------- /remember -------------------------------------------------------


class RememberRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: MemoryKind
    title: str | None = None
    content: str = Field(min_length=1)
    scope: Scope
    visible_to: list[RoleKind] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RememberResponse(BaseModel):
    memory_id: UUID


# ---------- /recall ---------------------------------------------------------


class RecallRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1)
    scope: Scope
    k: int = Field(default=10, ge=1, le=100)
    kinds: list[MemoryKind] | None = None
    min_score: float | None = Field(default=None, ge=0.0, le=1.0)


class RecallHit(BaseModel):
    memory_id: UUID
    score: float
    content: str
    kind: MemoryKind
    title: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


# ---------- /forget ---------------------------------------------------------


class ForgetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    memory_id: UUID
    reason: str = Field(min_length=1)
    scope: Scope


class ForgetResponse(BaseModel):
    ok: bool = True


# ---------- /healthz --------------------------------------------------------


class HealthResponse(BaseModel):
    ok: bool
    version: str
    embed_model: str
    embed_dim: int
    embed_provider: str
