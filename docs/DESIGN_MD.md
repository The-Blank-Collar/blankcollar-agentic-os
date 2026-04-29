# design.md — Brand Foundation as a runtime artefact

The Karpathy / Eric Osiu insight: an AI system without a stable, written
*brand foundation* has no idea what voice it should speak in. It either
defaults to the average of the internet ("Let's leverage cutting-edge
synergy!") or to whatever the last user prompt nudged it toward. Voice
drifts run-to-run.

The fix is mundane: keep a short, structured markdown file that names the
promise, voice, banned and preferred words, tone examples, and positioning
— and have the AI read it before every response.

This document specifies the **design.md format** Blank Collar uses for
that file, and how the runtime stack consumes it.

## Where the file lives

```
brand/
  blankcollar.md     # default — loaded by Hermes + OpenClaw at startup
  acme.md            # add per-org files here, swap with BRAND_NAME=acme
```

Mounted read-only into both containers at `/app/brand`. Edit live; the next
agent run picks up the change (no rebuild).

`BRAND_DIR` (default `/app/brand`) and `BRAND_NAME` (default `blankcollar`)
control which file is loaded.

## Format

Plain GitHub-flavoured markdown. Recognised `## ` sections (case-insensitive,
all optional):

| Section | Shape | Purpose |
|---|---|---|
| `## Promise` | Freeform 1–2 sentences | The one-line tagline / north star. |
| `## Voice` | Bullet list | Adjectives or short rules ("Calm.", "Plain."). |
| `## Banned words` | Comma-separated **or** bullet list | Words the AI must not emit. Lint targets. |
| `## Preferred words` | Comma-separated **or** bullet list | Words the AI should reach for. |
| `## Examples` | Bullet list using `Don't: … → Do: …` | Concrete tone correction pairs. |
| `## Positioning` | Freeform 1–3 sentences | What we are and what we are not. |
| `## Closing line` | Freeform | Optional sign-off rule (e.g. "End with: Decision needed."). |

Anything else (other headings, blockquotes, paragraphs outside a recognised
section) is ignored. Missing sections are simply skipped — the file stays
useful at any level of completeness.

A blockquote at the top is a good place for an editor's note. The loader
strips lines starting with `>` so they never bleed into the parsed values.

## How agents use it

### Hermes — system-prompt prefix

`apps/hermes/app/runner.py` loads the file once at module import and
prepends a compact `[Brand Foundation]` block to its system prompt:

```
[Brand Foundation]
Promise: Work is for bots. Life is for humans.
Voice: Calm; Plain; Specific; Confident, not arrogant
Avoid these words and phrases: synergy, leverage, unleash, ...
Prefer these words: goal, outcome, plan, agent, hire, ...
Tone examples:
  - Don't: "Unleash the power of AI." → Do: "Hire your first agent."
  - ...
Positioning: An OS for running a small company without running yourself...
Closing: Always end agent-facing replies with one line: "Decision needed: …"

You are Hermes, the general-purpose workforce agent of the Blank Collar Agentic OS.
...
```

Every Hermes call carries the brand. No per-call configuration needed.

### OpenClaw — outbound email lint

`apps/openclaw/app/runner.py` uses the same loader to scan
`email.send` drafts (subject + body) for banned terms. Hits go into the run
output as `brand_lint: ["synergy", "10x", ...]` and into the gbrain memory's
metadata. The mail still ships — flagging is advisory, not a gate, because
a human reviewer is in the loop on the dashboard.

### Future hook points

- **LangGraph classifier** could prefer the brand-conformant agent for
  customer-facing copy.
- **Paperclip dashboard** could surface `brand_lint` hits on the run card.
- **Per-org brand** — Phase 6 will store a per-`(org)` override row in
  Postgres that the loader prefers over the file.

## Editing the file

Pull request, review, merge. Treat it like code. A regression in the brand
file has the same blast radius as a regression in a system prompt — every
reply suddenly sounds different.

## Why a file, not a database row?

For the same reason the rest of this stack is local-first: a markdown file
diffs cleanly, version-controls cleanly, and works offline. A future
per-org override layer can live in Postgres without changing the loader's
contract.

## Tests

- `apps/hermes/tests/test_brand.py` — 13 tests covering parse, system-prompt
  block, banned-word lint (case, hyphens, phrases, word boundaries),
  missing files, missing sections.
- `apps/openclaw/tests/test_brand.py` — 4 tests covering the email.send
  lint surface.

## Why not call it brand.yaml or brand.toml?

Because the people writing it are not always engineers, and markdown is the
one format every non-engineer already reads and edits without thinking about
it. The structure is loose enough that a marketing person can update it
without breaking the parser.
