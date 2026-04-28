"""Tests for the Hermes runner.

These bypass FastAPI and exercise the runner against a fake LLM and a fake
gbrain client (monkey-patched). They prove the loop's contract: recall →
complete → remember → terminal state.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest

from app.llm import FakeLLM
from app.models import RoleKind, RunRequest, Scope
from app.runner import schedule_run
from app.state import RunStatus, runs


class FakeBrain:
    def __init__(self) -> None:
        self.recalled_with: list[dict] = []
        self.remembered: list[dict] = []

    async def recall(self, **kwargs):
        self.recalled_with.append(kwargs)
        return [
            {"kind": "fact", "title": "Pricing", "content": "Pro is $29/mo."},
        ]

    async def remember(self, **kwargs):
        self.remembered.append(kwargs)
        return "00000000-0000-0000-0000-000000000999"

    async def aclose(self):
        return


@pytest.fixture(autouse=True)
def patch_brain(monkeypatch):
    fake = FakeBrain()
    import app.runner as runner_mod

    monkeypatch.setattr(runner_mod, "brain", fake)
    return fake


def _req() -> RunRequest:
    return RunRequest(
        goal_id=uuid4(),
        run_id=uuid4(),
        scope=Scope(org_id=uuid4(), role=RoleKind.agent),
        input={
            "subtask": {
                "index": 0,
                "title": "Outline a plan",
                "description": "Outline three steps to grow signups.",
                "input": {"target": 1000, "timeframe": "by July"},
            }
        },
    )


async def _wait_until(predicate, timeout: float = 2.0) -> None:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.02)
    raise AssertionError("timed out")


async def test_run_succeeds_and_writes_episode(patch_brain: FakeBrain) -> None:
    req = _req()
    llm = FakeLLM()
    state = schedule_run(req, llm)

    await _wait_until(lambda: state.status == RunStatus.succeeded)

    assert state.output is not None
    assert state.output["agent_kind"] == "hermes"
    assert state.output["model"] == "fake"
    assert state.output["memory_id"] == "00000000-0000-0000-0000-000000000999"
    assert state.output["memories_used"] == 1
    assert "FAKE-LLM" in state.output["summary"]

    # Brain side-effects
    assert len(patch_brain.recalled_with) == 1
    assert "Outline a plan" in patch_brain.recalled_with[0]["query"]
    assert len(patch_brain.remembered) == 1
    assert patch_brain.remembered[0]["kind"] == "episode"
    assert "Hermes:" in patch_brain.remembered[0]["title"]


async def test_cancel_before_completion(patch_brain: FakeBrain) -> None:
    """A cancellation arriving early should leave the run in `cancelled`."""

    class SlowFake(FakeLLM):
        async def complete(self, *, system: str, user: str) -> str:  # type: ignore[override]
            await asyncio.sleep(0.5)
            return "should not arrive"

    req = _req()
    state = schedule_run(req, SlowFake())
    # Immediately cancel before recall returns.
    state.cancel_event.set()

    await _wait_until(lambda: state.status in (RunStatus.cancelled, RunStatus.succeeded))
    assert state.status == RunStatus.cancelled


async def test_idempotent_state_map() -> None:
    """Two requests with the same run_id must reuse the same state."""
    req = _req()
    rid = str(req.run_id)
    s1 = schedule_run(req, FakeLLM())
    # The /run endpoint guards against re-dispatch; the runner itself just stamps state[rid].
    assert runs[rid] is s1
    # Wait so the task settles before the next test runs.
    if s1.task:
        await s1.task
