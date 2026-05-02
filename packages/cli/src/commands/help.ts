export const HELP_TEXT = `bc — Blank Collar Agentic OS CLI

USAGE
  bc <command> [args] [--json | --pretty]

COMMANDS
  health                   probe / surface every backend service
  capture <text> [--kind=ephemeral|standing|routine|decision]
                           toss natural language at the assistant; --kind pins it
  inbox                    show what wants you (decisions, drafts, blocked, ...)
  inbox --summary          counts per kind + urgent count (no items)
  inbox ack <goal_id>      mark a draft / routine output as seen
  goals                    list active goals
  goals --summary          rollup: counts per kind / status + stalled
  goals --stalled[=N]      list goals with no run activity in N days (default 7)
  goals --dept=<slug|uuid> filter to one department
  goal <id>                show one goal with KRs + contributors
  goal <id> --stats        + run rollup (totals, avg duration, last run)
  close <goal_id>          mark a goal achieved
  pause <goal_id>          pause a goal (becomes blocked in inbox)
  resume <goal_id>         resume a paused goal
  archive <goal_id>        archive a goal
  kr list <goal_id>        list key results on a goal
  kr add <goal_id> <label> [--target=N --current=N --unit=X --due=ISO]
  kr set <kr_id> <value> [--unit=X]   update a KR's current value
  kr rm <kr_id>            delete a KR
  briefing                 today's editorial briefing
  briefing list [--kind=daily|weekly|on_demand] [--limit=N]   past briefings
  agents                   list active agents
  agent <id>               show one agent's live state + recent runs
  agent <id> --stats       + lifetime run rollup (totals, success rate, avg)
  skills [--scope=X --agent=Y]   list available skills (filtered)
  tools [--transport=stdio|http|sse|websocket]   list MCP tools
  tool <slug>              show one MCP tool's manifest
  audit                    run a self-audit on the last 7 days
  level-up                 propose changes from the latest audit
  approvals                list pending approvals
  approvals --summary      counts per urgency + 7-day approve/decline rates
  payments                 outbound spend safety controls (Phase 9)
  payments status          show settings + kill-switch state
  payments enable|disable  master switch
  payments configure [--limit=cents --threshold=cents --period=monthly --email=...]
  payments kill [reason]   activate kill switch (halts all payments)
  payments resume [reason] clear kill switch
  payments limits          list per-agent caps
  payments limits add <agent_id> --limit=<cents> [--period=monthly --category=...]
  payments limits rm <id>  remove a per-agent cap
  payments requests [--status=pending|approved|... --limit=N]
  policies                 list policy rules (role/agent/skill/action → effect)
  policy add --effect=allow|approve|deny [--role=R --agent=A --skill=S --action=K --priority=N --reason=...]
  policy rm <id>           remove a policy
  policy test [--role=R --agent=A --skill=S --action=K]   dry-run the evaluator
  approve <id> [note]      approve an agent's proposed action
  decline <id> [note]      decline an agent's proposed action
  knowledge [--scope=X --hot --tag=Y --q=text]   list wiki docs (filtered)
  knowledge get <slug>     show one doc + backlinks
  channels                 connected providers + sentinel rows
  depts                    list departments + active goal counts
  brain                    constellation graph (json by default)
  brain --summary          counts per node/edge kind
  runs --goal=<id>         list runs on a goal
  run <id> [--watch]       single run; --watch streams live status via SSE
  routines                 list active kind=routine goals + next cron fire
  triggers <goal_id>       list schedule/event/api triggers on a goal
  fire <trigger_id>        manually fire a trigger (api triggers need --token)
  search <query>           cross-corpus search across goals/captures/knowledge/agents
  tail [--limit=N]         most recent runs across the org (default 20)
  heartbeat [--days=N]     14-day pulse: captures, runs, goals, activity
  logs [--action=X --target=Y --limit=N]   recent core.audit_log entries
  llm [--limit=N --status=ok|error --provider=X]   recent LLM calls (Portkey-routed)
  llm --summary [--hours=N]   rolled-up LLM cost/latency for the period
  whoami                   show your resolved scope (org, role, department)
  onboard --mode=<m>       start the interview (single_user | multi_user)

GLOBAL FLAGS
  --json                   force raw JSON output
  --pretty                 force editorial output (default when stdout is a TTY)
  --version                print the bc version and exit

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
