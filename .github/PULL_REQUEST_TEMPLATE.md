# Summary

<!-- One sentence: what does this PR change and why? -->

## Phase / area

- [ ] Phase 0 — Groundwork
- [ ] Phase 1 — Memory layer
- [ ] Phase 2 — Paperclip orchestrator
- [ ] Phase 3 — Workforce agents
- [ ] Phase 4 — Goal Command Centre
- [ ] Phase 5 — Intelligence layer
- [ ] Phase 6 — Auth / multi-tenancy
- [ ] Phase 7 — Payments / onboarding
- [ ] Cross-cutting (docs, CI, infra)

## QA checklist

- [ ] `./infra/scripts/doctor.sh` passes locally after this change
- [ ] `docker compose down -v && ./infra/scripts/bootstrap.sh` works from a clean state
- [ ] `.env.example` updated if any new env var was introduced
- [ ] README / docs updated if any user-visible behaviour changed
- [ ] No secrets committed
- [ ] `core.audit_log` is written when state mutations are added

## Goal-first sanity check

Does this surface a goal/outcome to the user, or does it surface plumbing? If plumbing, is it gated behind an "advanced" view?

## Screenshots / logs

<!-- Optional but appreciated. -->
