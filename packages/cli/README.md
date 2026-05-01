# `bc` — Blank Collar CLI

The terminal-side complement to the Paperclip API. Every endpoint is reachable through one short command, with editorial output for humans and clean JSON for pipes.

## Install

```bash
cd packages/cli
npm install
npm run build
npm link              # exposes `bc` globally
```

Or run from source without linking:

```bash
npm run dev -- health
```

## Configure

| Env var       | Purpose                                            | Default                        |
|---------------|----------------------------------------------------|--------------------------------|
| `BC_API_URL`  | Paperclip base URL                                 | `http://localhost:3000`        |
| `BC_ORG_SLUG` | sent as `X-BC-Org-Slug` header                     | `blankcollar-personal`         |
| `BC_TOKEN`    | Supabase JWT (only when `PAPERCLIP_AUTH_ENFORCE=true`) | unset                       |
| `BC_DEBUG`    | print full error bodies on non-2xx                 | unset                          |

## Commands

```
bc health                         # probe every service
bc capture "<text>"               # natural-language input
bc inbox                          # what wants you
bc inbox ack <goal_id>            # dismiss a draft / routine output

bc goals                          # active goals
bc goal <id>                      # one goal + KRs + contributors
bc approve <goal_id> [note]       # resolve a decision goal
bc decline <goal_id> [note]

bc briefing                       # today's editorial briefing
bc briefing generate --kind=daily # force-regenerate

bc agents                         # active agents
bc agent <id>                     # live state + recent runs

bc skills                         # available skills
bc skill invoke <slug> --input.url=https://...

bc audit                          # self-audit (7-day default)
bc level-up                       # propose changes from latest audit

bc approvals                      # pending approvals
bc approval approve <id> [note]
bc approval decline <id> [note]

bc knowledge                      # wiki list
bc knowledge get <slug>

bc channels                       # connected providers + sentinels

bc onboard --mode=single_user     # interactive interview
```

## Output modes

- **pretty** (default when stdout is a TTY) — short editorial lines.
- **json** (default when piped, or with `--json`) — pretty-printed JSON.
- Force one or the other with `--pretty` / `--json`.

## Examples

```bash
# Tell the assistant about a recurring routine.
bc capture "Every Monday morning, summarise the weekend in my inboxes"

# See what wants you, prettily.
bc inbox

# Pipe the briefing's markdown into a viewer.
bc briefing | jq -r .summary_md | glow -

# Run a Hermes-narrated audit and apply the level-up.
bc audit
bc level-up
bc level-up --json | jq '.suggestions[].proposal'

# Walk the personal-mode onboarding interview.
bc onboard --mode=single_user --user-name "Lior" --user-email lior@example.com
```

## Behaviour

- Exit code matches HTTP status family on failure (1 for client/server errors, 2 for argv errors).
- All commands are stateless — config lives entirely in env vars + flags.
- No third-party CLI framework: argv parser is hand-rolled, ~70 lines.

## Tests

```bash
npm test          # vitest, 26 cases (argv, api client, format)
npm run typecheck
npm run lint
```
