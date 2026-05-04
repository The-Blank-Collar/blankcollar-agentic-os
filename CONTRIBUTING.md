# Contributing

Thanks for caring about Blank Collar. Contributions are welcome — this is the working agreement.

## Before you change anything

1. Read `docs/ARCHITECTURE.md` and `docs/GOAL_FIRST.md`. Architecture decisions and the goal-first principle are *the* source of truth.
2. Skim `docs/ROADMAP.md` to find the right phase for your change.
3. Check open issues to avoid duplicating work.

## Local workflow (no LLM credentials needed)

```bash
git clone https://github.com/the-blank-collar/blankcollar-agentic-os.git
cd blankcollar-agentic-os
cp .env.example .env
make bootstrap     # spins up the whole stack
make doctor        # 26/26 green when ready
```

The stack runs in **FakeLLM mode** out of the box — every Claude call returns
a deterministic canned reply prefixed with `[FakeLLM mode — set
PORTKEY_API_KEY in .env to enable real Claude]`. The whole pipeline still
works (briefings, classifier, Telegram bot, Hermes runs) so you can develop
features end-to-end without paying for API tokens.

When you're ready for real Claude:

1. Create a Portkey account at https://app.portkey.ai/.
2. Either (a) add a workspace + Anthropic provider in the Model Catalog and
   set `PAPERCLIP_LLM_MODEL=@your-workspace/claude-sonnet-4-5-…`, OR
   (b) create a legacy Virtual Key and set `PORTKEY_VIRTUAL_KEY_ANTHROPIC`.
3. Set `PORTKEY_API_KEY` in `.env`.
4. `docker compose up -d` to pick up the new env vars.

You can also explicitly force FakeLLM mode (handy when testing offline)
with `BLANKCOLLAR_FAKE_LLM=true` in `.env` — that overrides any Portkey
credentials you might have set.

## Feature workflow

```bash
git checkout -b feat/<short-description>
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
