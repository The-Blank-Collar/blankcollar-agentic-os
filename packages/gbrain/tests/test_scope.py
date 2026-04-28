"""Tests for the role-scope filter — the security-critical pure function in gbrain."""

from __future__ import annotations

from uuid import uuid4

from app.models import RoleKind, Scope
from app.scope import (
    DEFAULT_VISIBLE_TO,
    build_qdrant_filter,
    can_role_see,
    effective_visible_to,
)


# ---------- effective_visible_to -------------------------------------------


def test_default_when_none() -> None:
    assert effective_visible_to(None) == list(DEFAULT_VISIBLE_TO)


def test_default_when_empty() -> None:
    assert effective_visible_to([]) == list(DEFAULT_VISIBLE_TO)


def test_dedupes_preserving_order() -> None:
    out = effective_visible_to(
        [RoleKind.team_member, RoleKind.owner, RoleKind.team_member]
    )
    assert out == [RoleKind.team_member, RoleKind.owner]


# ---------- can_role_see ---------------------------------------------------


def test_owner_always_sees() -> None:
    assert can_role_see(RoleKind.owner, [])
    assert can_role_see(RoleKind.owner, [RoleKind.team_member])


def test_auditor_always_sees() -> None:
    assert can_role_see(RoleKind.auditor, [])
    assert can_role_see(RoleKind.auditor, [RoleKind.owner])


def test_team_member_blocked_by_default() -> None:
    assert not can_role_see(RoleKind.team_member, list(DEFAULT_VISIBLE_TO))


def test_team_member_allowed_when_listed() -> None:
    assert can_role_see(
        RoleKind.team_member,
        [RoleKind.owner, RoleKind.department_lead, RoleKind.team_member],
    )


def test_agent_inherits_only_when_listed() -> None:
    assert not can_role_see(RoleKind.agent, list(DEFAULT_VISIBLE_TO))
    assert can_role_see(RoleKind.agent, [RoleKind.agent])


# ---------- build_qdrant_filter (structural assertions) --------------------


def _scope(role: RoleKind, *, dept: bool = False, goal: bool = False) -> Scope:
    return Scope(
        org_id=uuid4(),
        department_id=uuid4() if dept else None,
        goal_id=uuid4() if goal else None,
        role=role,
    )


def _flatten_keys(node) -> list[str]:
    """Walk the Filter tree and collect every key that appears in a FieldCondition."""
    keys: list[str] = []
    # qdrant_client filter objects expose `must`, `should`, `must_not` as iterables of conditions.
    for attr in ("must", "should", "must_not"):
        seq = getattr(node, attr, None) or []
        for cond in seq:
            key = getattr(cond, "key", None)
            if key:
                keys.append(key)
            # IsNullCondition has `is_null.key`
            is_null = getattr(cond, "is_null", None)
            if is_null is not None:
                k = getattr(is_null, "key", None)
                if k:
                    keys.append(f"{k}__nullable")
            # Nested Filter
            if hasattr(cond, "must") or hasattr(cond, "should") or hasattr(cond, "must_not"):
                keys.extend(_flatten_keys(cond))
    return keys


def test_filter_always_pins_org() -> None:
    s = _scope(RoleKind.owner)
    f = build_qdrant_filter(s)
    keys = _flatten_keys(f)
    assert "org_id" in keys


def test_filter_owner_does_not_check_visible_to() -> None:
    s = _scope(RoleKind.owner)
    f = build_qdrant_filter(s)
    keys = _flatten_keys(f)
    # Owners read everything in their org, regardless of `visible_to`.
    assert "visible_to" not in keys


def test_filter_auditor_does_not_check_visible_to() -> None:
    s = _scope(RoleKind.auditor)
    f = build_qdrant_filter(s)
    keys = _flatten_keys(f)
    assert "visible_to" not in keys


def test_filter_team_member_checks_visible_to() -> None:
    s = _scope(RoleKind.team_member)
    f = build_qdrant_filter(s)
    keys = _flatten_keys(f)
    assert "visible_to" in keys


def test_filter_agent_checks_visible_to() -> None:
    s = _scope(RoleKind.agent)
    f = build_qdrant_filter(s)
    keys = _flatten_keys(f)
    assert "visible_to" in keys


def test_filter_department_scope_includes_nullable_branch() -> None:
    s = _scope(RoleKind.team_member, dept=True)
    f = build_qdrant_filter(s)
    keys = _flatten_keys(f)
    assert "department_id" in keys
    assert "department_id__nullable" in keys, "org-wide memories must remain reachable"


def test_filter_goal_scope_includes_nullable_branch() -> None:
    s = _scope(RoleKind.team_member, goal=True)
    f = build_qdrant_filter(s)
    keys = _flatten_keys(f)
    assert "goal_id" in keys
    assert "goal_id__nullable" in keys, "memories not bound to a goal must remain reachable"


def test_filter_no_dept_no_goal_omits_those_keys() -> None:
    s = _scope(RoleKind.team_member)
    f = build_qdrant_filter(s)
    keys = _flatten_keys(f)
    assert "department_id" not in keys
    assert "goal_id" not in keys
