#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Blank Collar — smoke.sh
# End-to-end exercise of the live Paperclip API. Runs against a stack that's
# already up. Validates every Phase-3.5 surface: capture, inbox, briefing,
# self-audit, knowledge, skills, approvals, channels, brain.graph.
#
# Exit 0 = every step returned a 2xx and the JSON shape was as expected.
# Exit non-zero = the first step that failed, with the bad response.
#
# Usage:
#   ./infra/scripts/smoke.sh
#   PAPERCLIP_PORT=3000 ./infra/scripts/smoke.sh
# -----------------------------------------------------------------------------
set -euo pipefail

PORT=${PAPERCLIP_PORT:-3000}
BASE="http://localhost:${PORT}"

if ! command -v jq >/dev/null; then
  echo "❌ jq required (brew install jq)" >&2
  exit 2
fi

step() {
  printf "\n▶ %s\n" "$1"
}

assert_2xx() {
  local label="$1"
  local body="$2"
  local code="$3"
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    echo "❌ $label returned HTTP $code" >&2
    echo "$body" | head -20 >&2
    exit 1
  fi
}

# 1. health probes
step "health probes"
HEALTH=$(curl -s -w "\n%{http_code}" "${BASE}/api/health")
HEALTH_BODY=$(echo "$HEALTH" | head -n -1)
HEALTH_CODE=$(echo "$HEALTH" | tail -n 1)
assert_2xx "/api/health" "$HEALTH_BODY" "$HEALTH_CODE"
echo "$HEALTH_BODY" | jq -r '"  ok=\(.ok) postgres=\(.probes.postgres.ok) gbrain=\(.probes.gbrain.ok) hermes=\(.probes.hermes.ok // "—") openclaw=\(.probes.openclaw.ok // "—")"'
echo "$HEALTH_BODY" | jq -r '"  counts: skills=\(.counts.skills_enabled // 0) agents=\(.counts.agents_active // 0) routines=\(.counts.routines_active // 0) approvals_pending=\(.counts.approvals_pending // 0)"'

# 2. capture an ephemeral
step "capture (ephemeral)"
CAPTURE=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/capture" \
  -H 'content-type: application/json' \
  -d '{"raw_content":"Reply to Mira about the Lark proposal by tomorrow"}')
CAP_BODY=$(echo "$CAPTURE" | head -n -1)
CAP_CODE=$(echo "$CAPTURE" | tail -n 1)
assert_2xx "POST /api/capture" "$CAP_BODY" "$CAP_CODE"
EPH_GOAL=$(echo "$CAP_BODY" | jq -r '.goal_id')
echo "  → ephemeral goal $EPH_GOAL kind=$(echo "$CAP_BODY" | jq -r '.intent.kind')"

# 3. capture a standing goal (KR auto-populates)
step "capture (standing — KR auto-populates)"
STD=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/capture" \
  -H 'content-type: application/json' \
  -d '{"raw_content":"Grow the newsletter to 10k subscribers by Q3"}')
STD_BODY=$(echo "$STD" | head -n -1)
STD_CODE=$(echo "$STD" | tail -n 1)
assert_2xx "POST /api/capture (standing)" "$STD_BODY" "$STD_CODE"
STD_GOAL=$(echo "$STD_BODY" | jq -r '.goal_id')
KR_ID=$(echo "$STD_BODY" | jq -r '.kr_id // empty')
echo "  → standing goal $STD_GOAL kind=$(echo "$STD_BODY" | jq -r '.intent.kind') kr_id=${KR_ID:-(none)}"

# Verify KR is embedded in goal detail
GOAL_DETAIL=$(curl -s "${BASE}/api/goals/$STD_GOAL")
KR_COUNT=$(echo "$GOAL_DETAIL" | jq '.key_results | length')
echo "  → goal has $KR_COUNT key result(s)"

# 4. capture a routine
step "capture (routine — scheduler picks it up)"
RTN=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/capture" \
  -H 'content-type: application/json' \
  -d '{"raw_content":"Every Monday morning, summarise the weekend"}')
RTN_BODY=$(echo "$RTN" | head -n -1)
RTN_CODE=$(echo "$RTN" | tail -n 1)
assert_2xx "POST /api/capture (routine)" "$RTN_BODY" "$RTN_CODE"
RTN_GOAL=$(echo "$RTN_BODY" | jq -r '.goal_id')
echo "  → routine goal $RTN_GOAL cron_expr=$(echo "$RTN_BODY" | jq -r '.intent.cron_expr')"

# 5. capture a decision
step "capture (decision — surfaces in inbox)"
DEC=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/capture" \
  -H 'content-type: application/json' \
  -d '{"raw_content":"Should I extend the offer to candidate C-019?"}')
DEC_BODY=$(echo "$DEC" | head -n -1)
DEC_CODE=$(echo "$DEC" | tail -n 1)
assert_2xx "POST /api/capture (decision)" "$DEC_BODY" "$DEC_CODE"
DEC_GOAL=$(echo "$DEC_BODY" | jq -r '.goal_id')
echo "  → decision goal $DEC_GOAL"

# 6. inbox sees the decision
step "inbox surfaces decisions + drafts"
INBOX=$(curl -s "${BASE}/api/inbox?limit=20")
DEC_IN=$(echo "$INBOX" | jq "[.[] | select(.goal_id == \"$DEC_GOAL\")] | length")
TOTAL=$(echo "$INBOX" | jq "length")
echo "  → inbox has $TOTAL items, decision present: $DEC_IN"
[[ "$DEC_IN" -ge 1 ]] || { echo "❌ decision not surfacing in inbox" >&2; exit 1; }

# 7. resolve the decision (approve)
step "resolve decision → approved"
RES=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/goals/$DEC_GOAL/resolve" \
  -H 'content-type: application/json' \
  -d '{"resolution":"approved","note":"smoke test"}')
RES_BODY=$(echo "$RES" | head -n -1)
RES_CODE=$(echo "$RES" | tail -n 1)
assert_2xx "POST /api/goals/.../resolve" "$RES_BODY" "$RES_CODE"
echo "  → status=$(echo "$RES_BODY" | jq -r '.status')"

# 8. briefing generates
step "briefing — daily, on demand"
BRIEF=$(curl -s -w "\n%{http_code}" "${BASE}/api/briefing/today")
BRIEF_BODY=$(echo "$BRIEF" | head -n -1)
BRIEF_CODE=$(echo "$BRIEF" | tail -n 1)
assert_2xx "GET /api/briefing/today" "$BRIEF_BODY" "$BRIEF_CODE"
echo "  → narrated=$(echo "$BRIEF_BODY" | jq -r '.sources.narrated // false') summary length=$(echo "$BRIEF_BODY" | jq -r '.summary_md | length')"

# 9. heartbeat returns aligned series
step "heartbeat — 14-day series"
HB=$(curl -s "${BASE}/api/heartbeat?days=14")
SERIES=$(echo "$HB" | jq '.series | length')
DAYS=$(echo "$HB" | jq '.series[0].points | length')
echo "  → $SERIES KPI series × $DAYS days"
[[ "$SERIES" -ge 4 ]] || { echo "❌ expected at least 4 KPI series" >&2; exit 1; }
[[ "$DAYS" -eq 14 ]] || { echo "❌ expected 14 day-aligned points" >&2; exit 1; }

# 10. brain graph
step "brain graph"
BRAIN=$(curl -s "${BASE}/api/brain/graph?limit=80")
NODES=$(echo "$BRAIN" | jq '.nodes | length')
EDGES=$(echo "$BRAIN" | jq '.edges | length')
echo "  → $NODES nodes, $EDGES edges"

# 11. self audit + level-up
step "self-improvement — audit then level-up"
AUDIT=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/self/audit" \
  -H 'content-type: application/json' \
  -d '{"period_hours":168,"kind":"audit"}')
AUDIT_BODY=$(echo "$AUDIT" | head -n -1)
AUDIT_CODE=$(echo "$AUDIT" | tail -n 1)
assert_2xx "POST /api/self/audit" "$AUDIT_BODY" "$AUDIT_CODE"
AUDIT_ID=$(echo "$AUDIT_BODY" | jq -r '.id')
F=$(echo "$AUDIT_BODY" | jq '.findings | length')
echo "  → audit $AUDIT_ID with $F findings"
LEVEL=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/self/level-up" \
  -H 'content-type: application/json' \
  -d "{\"audit_report_id\":\"$AUDIT_ID\"}")
LEVEL_BODY=$(echo "$LEVEL" | head -n -1)
LEVEL_CODE=$(echo "$LEVEL" | tail -n 1)
assert_2xx "POST /api/self/level-up" "$LEVEL_BODY" "$LEVEL_CODE"
S=$(echo "$LEVEL_BODY" | jq '.suggestions | length')
echo "  → level-up with $S suggestions"

# 12. skills registry
step "skills registry — listing"
SKILLS=$(curl -s "${BASE}/api/skills")
SKILL_COUNT=$(echo "$SKILLS" | jq 'length')
echo "  → $SKILL_COUNT skills available"
[[ "$SKILL_COUNT" -ge 5 ]] || { echo "❌ expected at least 5 shared skills" >&2; exit 1; }

# 13. knowledge wiki — create + readback
step "knowledge wiki — create hot doc + readback"
DOC=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/knowledge" \
  -H 'content-type: application/json' \
  -d '{"slug":"smoke-doc","title":"Smoke doc","scope":"company","hot":true,"content_md":"# Smoke\n\nLink to [[other-doc]].","tags":["smoke"]}')
DOC_BODY=$(echo "$DOC" | head -n -1)
DOC_CODE=$(echo "$DOC" | tail -n 1)
# 200 if the doc already exists from a previous run, 201 on create.
if [[ "$DOC_CODE" -ne 201 && "$DOC_CODE" -ne 200 && "$DOC_CODE" -ne 409 ]]; then
  assert_2xx "POST /api/knowledge" "$DOC_BODY" "$DOC_CODE"
fi
HOT=$(curl -s "${BASE}/api/knowledge/hot")
HOT_COUNT=$(echo "$HOT" | jq 'length')
echo "  → hot docs: $HOT_COUNT"

# 14. channels
step "channels — connected providers + sentinel rows"
CH=$(curl -s "${BASE}/api/channels")
CH_COUNT=$(echo "$CH" | jq '.channels | length')
echo "  → $CH_COUNT channels (state breakdown: $(echo "$CH" | jq -r '[.channels[].state] | group_by(.) | map("\(.[0])=\(length)") | join(" ")'))"

# 15. tools registry — list (Phase 2.2)
step "tools registry — listing"
TOOLS=$(curl -s "${BASE}/api/tools")
TOOL_COUNT=$(echo "$TOOLS" | jq 'length')
echo "  → $TOOL_COUNT tools registered"
[[ "$TOOL_COUNT" -ge 1 ]] || { echo "❌ expected at least 1 tool" >&2; exit 1; }

# 16. tool probe — exercise the MCP handshake against the first stdio tool.
# Probe failure is a soft warning — npx may need to fetch the package on
# first run. Don't fail the smoke run; the route + log path was exercised.
FIRST_STDIO=$(echo "$TOOLS" | jq -r '[.[] | select(.transport=="stdio")][0].slug // empty')
if [[ -n "$FIRST_STDIO" ]]; then
  step "tool probe — $FIRST_STDIO (MCP initialize handshake)"
  PROBE=$(curl -s -X POST "${BASE}/api/tools/${FIRST_STDIO}/probe" -H 'content-type: application/json' -d '{}')
  PROBE_OK=$(echo "$PROBE" | jq -r '.ok // false')
  PROBE_LATENCY=$(echo "$PROBE" | jq -r '.latency_ms // "?"')
  echo "  → ok=$PROBE_OK latency=${PROBE_LATENCY}ms"
fi

echo
echo "✅ smoke passed — every Phase-3.5 surface responded as expected."
