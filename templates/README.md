# Templates

Pre-shaped starting points. The OS uses these to bootstrap a new company in under 90 seconds during onboarding (Phase 7).

## Layout

```
templates/
├── companies/      ← whole-company starting kits (departments + agents + initial goals)
└── goals/          ← single-goal starting kits the user can spawn at any time
```

`companies/` is empty in Phase 0 — the company-template runtime lands in Phase 4 alongside the dashboard.

## Goal templates

A goal template is a YAML file describing a goal that's been useful enough to ship as a default. Each one is:

- Declarative — no code.
- Department-scoped.
- Stamped with the role that owns it.
- Includes a "what stays human" section — explicit decisions the user must make.

When the user picks a template from the dashboard, the OS materialises a `draft` row in `ops.goal` with `metadata` populated from the template, and (optionally) a starter plan.

See [`templates/goals/`](goals/) for the current set.

## How to add a template

1. Drop a `<slug>.yaml` file under `templates/goals/`.
2. Use one of the existing files as a model — the schema is intentionally simple.
3. The dashboard renders any new template in alphabetical order under its department.
4. Templates are version-controlled — bumping `version:` flags it as "updated" for users who already have an older copy.
