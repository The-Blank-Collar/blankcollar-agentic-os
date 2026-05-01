export const HELP_TEXT = `bc — Blank Collar Agentic OS CLI

USAGE
  bc <command> [args] [--json | --pretty]

COMMANDS
  health                   probe / surface every backend service
  capture <text>           toss natural language at the assistant
  inbox                    show what wants you (decisions, drafts, blocked, ...)
  inbox --summary          counts per kind + urgent count (no items)
  inbox ack <goal_id>      mark a draft / routine output as seen
  goals                    list active goals
  goal <id>                show one goal with KRs + contributors
  goal <id> --stats        + run rollup (totals, avg duration, last run)
  briefing                 today's editorial briefing
  agents                   list active agents
  agent <id>               show one agent's live state + recent runs
  skills                   list available skills
  audit                    run a self-audit on the last 7 days
  level-up                 propose changes from the latest audit
  approvals                list pending approvals
  approve <id> [note]      approve an agent's proposed action
  decline <id> [note]      decline an agent's proposed action
  knowledge                list wiki docs
  knowledge get <slug>     show one doc + backlinks
  channels                 connected providers + sentinel rows
  brain                    print the constellation graph (json only)
  runs --goal=<id>         list runs on a goal
  run <id> [--watch]       single run; --watch streams live status via SSE
  routines                 list active kind=routine goals
  triggers <goal_id>       list schedule/event/api triggers on a goal
  fire <trigger_id>        manually fire a trigger (api triggers need --token)
  search <query>           cross-corpus search across goals/captures/knowledge/agents
  tail [--limit=N]         most recent runs across the org (default 20)
  onboard --mode=<m>       start the interview (single_user | multi_user)

GLOBAL FLAGS
  --json                   force raw JSON output
  --pretty                 force editorial output (default when stdout is a TTY)

ENVIRONMENT
  BC_API_URL               base URL of the Paperclip API (default: http://localhost:3000)
  BC_ORG_SLUG              org slug header (default: blankcollar-personal)
  BC_TOKEN                 Supabase JWT, when auth is enforced

EXAMPLES
  bc capture "Every Monday morning, summarise the weekend in my inboxes"
  bc inbox --pretty
  bc briefing | jq .summary_md
  BC_API_URL=https://api.blankcollar.ai bc health
`;

export function runHelp(): number {
  process.stdout.write(HELP_TEXT);
  return 0;
}
