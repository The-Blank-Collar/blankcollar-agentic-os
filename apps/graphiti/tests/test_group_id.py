"""Tests for the scope → group_id mapping. The group_id is what isolates
facts per (org, department, goal) inside a single Neo4j instance, so the
mapping has to be stable and security-sensitive."""

from __future__ import annotations

from uuid import UUID

from app.graph import GraphitiWrapper
from app.models import RoleKind, Scope

ORG = UUID("11111111-1111-1111-1111-111111111111")
DEPT = UUID("22222222-2222-2222-2222-222222222222")
GOAL = UUID("33333333-3333-3333-3333-333333333333")


def test_org_only_scope() -> None:
    s = Scope(org_id=ORG, role=RoleKind.owner)
    assert GraphitiWrapper.group_id_for(s) == "11111111-1111-1111-1111-111111111111"


def test_org_plus_department() -> None:
    s = Scope(org_id=ORG, department_id=DEPT, role=RoleKind.team_member)
    g = GraphitiWrapper.group_id_for(s)
    assert g.startswith("11111111-1111-1111-1111-111111111111")
    assert "dept:22222222-2222-2222-2222-222222222222" in g


def test_full_scope_org_dept_goal() -> None:
    s = Scope(org_id=ORG, department_id=DEPT, goal_id=GOAL, role=RoleKind.agent)
    g = GraphitiWrapper.group_id_for(s)
    assert "11111111-1111-1111-1111-111111111111" in g
    assert "dept:22222222-2222-2222-2222-222222222222" in g
    assert "goal:33333333-3333-3333-3333-333333333333" in g


def test_different_orgs_get_different_group_ids() -> None:
    other_org = UUID("99999999-9999-9999-9999-999999999999")
    s1 = Scope(org_id=ORG, role=RoleKind.owner)
    s2 = Scope(org_id=other_org, role=RoleKind.owner)
    assert GraphitiWrapper.group_id_for(s1) != GraphitiWrapper.group_id_for(s2)


def test_role_does_not_affect_group_id() -> None:
    """group_id partitions data, not access. Role is a runtime check."""
    s_owner = Scope(org_id=ORG, role=RoleKind.owner)
    s_member = Scope(org_id=ORG, role=RoleKind.team_member)
    assert GraphitiWrapper.group_id_for(s_owner) == GraphitiWrapper.group_id_for(s_member)
