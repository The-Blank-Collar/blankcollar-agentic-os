# QA & Debugging Checklist

Run this list:
- before opening a PR,
- after pulling main,
- whenever something feels off.

## 1. The stack starts cleanly

- [ ] `docker compose down -v && ./infra/scripts/bootstrap.sh` finishes without errors
- [ ] `docker compose ps` shows every service `running` (and `healthy` where defined)
- [ ] `docker compose logs --tail=200` has **no** ERROR / FATAL lines

## 2. Healthchecks pass

- [ ] `./infra/scripts/doctor.sh` exits 0
- [ ] `curl -fsS http://localhost:6333/healthz` returns OK
- [ ] `psql postgresql://postgres:postgres@localhost:5432/blankcollar -c "SELECT 1;"` returns `1`
- [ ] `curl -fsS http://localhost:3000` returns the Paperclip placeholder HTML
- [ ] `curl -fsS http://localhost:8001`, `:8002`, `:8003` all return placeholder HTML

## 3. Schema integrity

- [ ] `\dn` shows `core`, `ops`, `brain`
- [ ] `\dt core.*` shows `organization, department, user_account, role_assignment, audit_log`
- [ ] `\dt ops.*` shows `agent, goal, run`
- [ ] `\dt brain.*` shows `memory`
- [ ] Seed query returns the demo org and 5 departments

## 4. Secrets hygiene

- [ ] `.env` is **not** tracked: `git status --ignored | grep .env` shows it as ignored
- [ ] `git ls-files | grep -i secret` returns nothing surprising
- [ ] No real API key appears in any committed file (grep for `sk-`, `pk_live`, `whsec_`)

## 5. Documentation matches reality

- [ ] Every service in `docker-compose.yml` is mentioned in the README port table
- [ ] Every env var used in compose is in `.env.example`
- [ ] Any new doc file is linked from the README's table of contents

## 6. Backwards compatibility

- [ ] Existing volume names still start with `bc_`
- [ ] No port number change without updating README + `.env.example`
- [ ] No removed env var without a deprecation note in `CHANGELOG.md`

## 7. Reproducibility

- [ ] A teammate running `git pull && ./infra/scripts/bootstrap.sh` from scratch ends up at the same state
- [ ] `docker compose down -v && ./infra/scripts/bootstrap.sh` brings the stack back without manual steps

## 8. Phase-0 specific gates

- [ ] No service hard-codes credentials — all via env
- [ ] No service exposes a port not listed in the README
- [ ] Placeholder pages show the Blank Collar card, not the nginx default
- [ ] `init.sql` runs idempotently (nothing breaks if you re-create the volume)

## When something fails

1. Capture the failure: `docker compose logs --no-color > /tmp/bc-failure.log`
2. Note the last action you took before it broke.
3. Try the matching section in `docs/LOCAL_SETUP.md#troubleshooting`.
4. If still stuck, reset (`./infra/scripts/reset.sh`) and re-run `bootstrap.sh`. If the failure is reproducible from a clean slate, it's a real bug — open an issue with the captured log.
