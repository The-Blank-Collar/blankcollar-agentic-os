# Contributing

Thanks for caring about Blank Collar. Until the project opens up publicly, contributions are by invitation. Once it does, this is the working agreement.

## Before you change anything

1. Read `docs/ARCHITECTURE.md` and `docs/GOAL_FIRST.md`. Architecture decisions and the goal-first principle are *the* source of truth.
2. Skim `docs/ROADMAP.md` to find the right phase for your change.
3. Check open issues to avoid duplicating work.

## Local workflow

```bash
git checkout -b feat/<short-description>
./infra/scripts/bootstrap.sh
# … make changes …
./infra/scripts/doctor.sh
git commit -m "feat: <imperative summary>"
```

## Commit style

Conventional Commits are encouraged but not enforced. The important thing: the *why*, not just the *what*, in the body.

## PR rules

- One logical change per PR.
- Update `.env.example` and `docs/` in the same PR if behaviour changes.
- Tick the QA checklist in the PR template — it isn't decoration.
- No secrets in commits, ever. CI will not catch every shape of secret; you must.

## AI collaborators (Claude / Cursor / etc.)

You're welcome here. Two rules:

1. **Never invent agents or skills outside the architecture.** If your plan needs a new layer, propose it in `docs/` first.
2. **Always run `./infra/scripts/doctor.sh`** before declaring a task done.
