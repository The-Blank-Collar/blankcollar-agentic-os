"""Role / department / goal scoping rules.

The filter built here is what stops a `team_member` recall from seeing
an owner-only memory. Every change to this file must keep its tests green.
"""

from __future__ import annotations

from qdrant_client.http import models as qm

from app.models import RoleKind, Scope

# Default visibility when a memory is written without an explicit `visible_to`.
DEFAULT_VISIBLE_TO: tuple[RoleKind, ...] = (RoleKind.owner, RoleKind.department_lead)


def effective_visible_to(visible_to: list[RoleKind] | None) -> list[RoleKind]:
    """Apply the safe default and de-duplicate while preserving order."""
    pool = list(visible_to) if visible_to else list(DEFAULT_VISIBLE_TO)
    seen: set[RoleKind] = set()
    out: list[RoleKind] = []
    for r in pool:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def can_role_see(role: RoleKind, visible_to: list[RoleKind]) -> bool:
    """Owners always read; auditors always read; otherwise the role must be in `visible_to`."""
    if role in (RoleKind.owner, RoleKind.auditor):
        return True
    return role in visible_to


def build_qdrant_filter(scope: Scope) -> qm.Filter:
    """Build the Qdrant payload filter for a recall.

    Rules:
      - Always require the same `org_id`. Cross-org reads are impossible.
      - If `department_id` is on the scope, restrict to that department OR org-wide memories
        (department_id IS NULL).
      - If `goal_id` is on the scope, allow that goal OR memories not bound to any goal.
      - For non-owner / non-auditor roles, require the role to be in `visible_to`.
    """
    must: list[qm.FieldCondition] = [
        qm.FieldCondition(key="org_id", match=qm.MatchValue(value=str(scope.org_id))),
    ]

    should_dept: list[qm.Condition] = []
    if scope.department_id is not None:
        # Memory's department matches OR memory is org-wide (no department).
        should_dept = [
            qm.FieldCondition(
                key="department_id",
                match=qm.MatchValue(value=str(scope.department_id)),
            ),
            qm.IsNullCondition(is_null=qm.PayloadField(key="department_id")),
        ]

    should_goal: list[qm.Condition] = []
    if scope.goal_id is not None:
        should_goal = [
            qm.FieldCondition(
                key="goal_id",
                match=qm.MatchValue(value=str(scope.goal_id)),
            ),
            qm.IsNullCondition(is_null=qm.PayloadField(key="goal_id")),
        ]

    role_filter: qm.Filter | None = None
    if scope.role not in (RoleKind.owner, RoleKind.auditor):
        role_filter = qm.Filter(
            must=[
                qm.FieldCondition(
                    key="visible_to",
                    match=qm.MatchAny(any=[scope.role.value]),
                ),
            ]
        )

    must_blocks: list[qm.Condition] = list(must)
    if should_dept:
        must_blocks.append(qm.Filter(should=should_dept))
    if should_goal:
        must_blocks.append(qm.Filter(should=should_goal))
    if role_filter is not None:
        must_blocks.append(role_filter)

    return qm.Filter(must=must_blocks)
