# Testing Strategy

How we know the OS works — today (Phase 0) and as we add layers.

## The pyramid we're aiming at

```
                  ┌─────────────┐
                  │   E2E (few) │   ← real Postgres + Qdrant + agents, full goal
                  └──────┬──────┘
                ┌────────▼────────┐
                │ Integration     │   ← service-to-service: gbrain ↔ Qdrant + PG
                │   (some)        │
                └────────┬────────┘
              ┌──────────▼──────────┐
              │   Unit (many)       │   ← pure functions, scope checkers, parsers
              └─────────────────────┘
```

## What we test in Phase 0

There's no application code yet, so the testable surface is intentionally small:

1. **Compose validity** — `docker compose config -q`. Caught by CI.
2. **Env coverage** — every `${VAR}` in compose is in `.env.example`. Caught by CI.
3. **Schema smoke test** — boot a fresh Postgres, run `init.sql`, assert schemas/tables exist and seed rows are present. Caught by CI.
4. **Shell scripts** — `shellcheck` over `infra/scripts/`. Caught by CI.
5. **Doctor script** — locally, `./infra/scripts/doctor.sh` exits 0. Manual gate before declaring "Phase 0 healthy."

## What we'll add in Phase 1 (gbrain)

- **Unit tests** for the scope-validation function. The most important pure function in the system.
- **Integration tests** that boot Postgres + Qdrant in CI (testcontainers or compose), exercise `/remember` → `/recall` → `/forget`, and verify role-scoped filtering.
- **Property tests** on the recall query: a fact written with `visible_to=[owner]` must never appear for a `team_member` recall, regardless of similarity score.

## What we'll add in Phase 2 (Paperclip)

- **Contract tests** against `API.md`. If the doc and the code drift, CI fails.
- **Auth/scope tests** on every controller. Negative tests are mandatory: a `team_member` calling owner-only endpoints must `403`.
- **Audit-log assertions**: every mutation test asserts the corresponding `core.audit_log` row.

## What we'll add in Phase 3 (real workforce)

- **Adapter conformance suite** — a single test pack the Hermes and OpenClaw adapters must pass. Add a new agent kind by passing the same suite.
- **Cancellation tests** — a `/run/{id}/cancel` while an LLM call is in flight must terminate within N seconds.
- **Cost-cap tests** — a run with a 5¢ budget must abort before exceeding it, even on a model that streams tokens slowly.

## End-to-end demo gates

Each phase has a "you can't claim done until this works" demo:

| Phase | Demo                                                                                  |
|-------|---------------------------------------------------------------------------------------|
| 0     | `make bootstrap && make doctor` exits 0 from a clean clone.                           |
| 1     | Write a fact via `/remember`, recall it via `/recall`, see role-scoping work.         |
| 2     | Create a goal, dispatch a fake run, see status update in the dashboard.               |
| 3     | Real Hermes summarizes today's HN front page and emails the user.                     |
| 4     | A non-coder signs up locally, types a goal, watches the plan, approves an action.     |

## Test data

- Phase 0 seeds the demo org + 5 departments via `init.sql`. Use that as the deterministic base.
- Subsequent phases add a `seed/` script that loads representative goals, runs, and memories — kept idempotent so you can re-run safely.

## What we don't do

- **No tests written *just* to bump coverage.** A test that exists only to assert wiring is noise.
- **No flaky retries.** If a test is flaky, fix the test (or the timing assumption it depends on). Never `retry: 3`.
- **No tests against external APIs in CI.** Use recorded fixtures for HTTP, and contract tests for shape.
- **No mocks of our own services.** Use the real container in integration tests; only mock external SaaS.

## How to run tests locally

Phase 0:

```bash
docker compose config -q                                    # compose syntax
./infra/scripts/doctor.sh                                   # local healthcheck
shellcheck infra/scripts/*.sh                               # if installed
```

Phase 1+ (planned):

```bash
make test               # unit + integration
make test-e2e           # boots full stack, runs the demo gate
```
