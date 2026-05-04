/**
 * Wire-shape types for the Paperclip REST API.
 *
 * Hand-mirrored from the Zod schemas + route response projections in
 * apps/paperclip/src/{schemas,routes}/*.ts. Kept lean — we only mirror
 * what the website console actually consumes. When you add a new
 * field server-side, mirror it here.
 *
 * Source-of-truth pairings:
 *   Goal              ← apps/paperclip/src/routes/goals.ts (GoalRow)
 *   GoalWithDetail    ← GET /api/goals/:id (GoalRow + key_results + contributors)
 *   KeyResult         ← apps/paperclip/src/routes/keyresults.ts response shape
 *   GoalCreate/Patch  ← apps/paperclip/src/schemas.ts (z.infer)
 *   Run               ← apps/paperclip/src/routes/runs.ts (RunRow)
 *   AgentSummary      ← GET /api/agents (AgentRow projection)
 *   AgentState        ← apps/paperclip/src/routes/agents.ts (AgentState export)
 *   AuditEntry        ← apps/paperclip/src/routes/audit.ts (AuditRow)
 */

export type GoalStatus = "draft" | "active" | "paused" | "achieved" | "archived";
export type GoalKind = "ephemeral" | "standing" | "routine" | "decision";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type RunMode = "live" | "simulation";

export interface Goal {
  id: string;
  org_id: string;
  department_id: string | null;
  owner_id: string | null;
  title: string;
  description: string | null;
  status: GoalStatus;
  kind: GoalKind;
  cron_expr: string | null;
  due_at: string | null;
  progress: string | null;
  target_value: string | null;
  actual_value: string | null;
  delta_label: string | null;
  track_state: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface KeyResult {
  id: string;
  label: string;
  target_value: string | null;
  current_value: string | null;
  unit: string | null;
  weight: number | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalContributor {
  agent_id: string | null;
  user_id: string | null;
  added_at: string;
}

export interface GoalWithDetail extends Goal {
  key_results: KeyResult[];
  contributors: GoalContributor[];
}

export interface GoalCreate {
  title: string;
  description?: string;
  department_id?: string | null;
  kind?: GoalKind;
  cron_expr?: string | null;
  due_at?: string | null;
  target_value?: string | null;
  metadata?: Record<string, unknown>;
}

export interface GoalPatch {
  title?: string;
  description?: string;
  kind?: GoalKind;
  cron_expr?: string | null;
  due_at?: string | null;
  progress?: number | null;
  target_value?: string | null;
  actual_value?: string | null;
  delta_label?: string | null;
  track_state?: string | null;
  metadata?: Record<string, unknown>;
  status?: GoalStatus;
}

export interface GoalListQuery {
  status?: GoalStatus;
  kind?: GoalKind;
  department_id?: string;
  stalled_for_days?: number;
  limit?: number;
}

export interface RunDispatch {
  subtask_index: number;
  agent_id?: string;
  mode?: RunMode;
}

export interface Run {
  id: string;
  goal_id: string;
  agent_id: string | null;
  status: RunStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface AgentSummary {
  id: string;
  org_id: string;
  kind: string;
  name: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface AgentRunSummary extends Run {
  goal_title: string | null;
}

export interface AgentState extends AgentSummary {
  status: "live" | "idle" | "warn";
  current_activity: string | null;
  last_run: AgentRunSummary | null;
  recent_runs: AgentRunSummary[];
  sigil_seed: string;
}

export interface KeyResultCreate {
  label: string;
  target_value?: string | null;
  current_value?: string | null;
  unit?: string | null;
  weight?: number;
  due_at?: string | null;
}

export interface KeyResultPatch {
  label?: string;
  target_value?: string | null;
  current_value?: string | null;
  unit?: string | null;
  weight?: number;
  due_at?: string | null;
}

// ---------- Brain graph (Phase 3 synthesized) ------------------------------

export type BrainNodeKind = "person" | "agent" | "goal" | "capture" | "tool";
export type BrainEdgeKind = "owns" | "contributes" | "captures" | "ran";

export interface BrainNode {
  id: string;
  kind: BrainNodeKind;
  label: string;
  metadata?: Record<string, unknown>;
}

export interface BrainEdge {
  from: string;
  to: string;
  kind: BrainEdgeKind;
}

export interface BrainGraph {
  nodes: BrainNode[];
  edges: BrainEdge[];
  truncated: boolean;
  generated_at: string;
}

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuditQuery {
  action?: string;
  target_type?: string;
  limit?: number;
}

// ---------- Inbox (Phase 4) -----------------------------------------------

export type InboxItemKind = "approval" | "decision" | "blocked" | "routine_output" | "draft";

export interface InboxItem {
  item_kind: InboxItemKind;
  goal_id: string;
  title: string;
  created_at: string;
  urgency: "urgent" | "normal";
  metadata: Record<string, unknown>;
}

export interface InboxSummary {
  total: number;
  urgent: number;
  by_kind: {
    approval: number;
    decision: number;
    blocked: number;
    routine_output: number;
    draft: number;
  };
}

// ---------- Autonomy modes (Phase 5b / Sprint 5.1) -------------------------

export type AutonomyModeName = "planning" | "auto_approve" | "ask_every_time" | "custom";
export type AutonomyScopeKind = "org" | "department" | "agent" | "skill";

export interface AutonomyModeRow {
  id: string;
  org_id: string;
  scope_kind: AutonomyScopeKind;
  scope_id: string | null;
  mode: AutonomyModeName;
  spending_cap_cents: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutonomyModeUpsert {
  scope_kind: AutonomyScopeKind;
  scope_id?: string | null;
  mode: AutonomyModeName;
  spending_cap_cents?: number | null;
  notes?: string | null;
}

export interface AutonomyResolved {
  mode: AutonomyModeName;
  spending_cap_cents: number | null;
  source: {
    scope_kind: AutonomyScopeKind;
    scope_id: string | null;
    notes: string | null;
  } | null;
}

// ---------- Safeguards (Phase 5b / Sprint 5.2) ----------------------------

export type SafeguardScopeKind = "org" | "department" | "agent";
export type PolicyEffect = "allow" | "approve" | "deny";

export interface SafeguardRow {
  id: string;
  org_id: string;
  scope_kind: SafeguardScopeKind;
  scope_id: string | null;
  content_md: string;
  content_hash: string;
  rule_count: number;
  created_at: string;
  updated_at: string;
}

export interface SafeguardParsedRule {
  effect: PolicyEffect;
  agent_kind: string | null;
  skill_slug: string | null;
  action_kind: string | null;
  reason: string;
  priority: number;
}

export interface SafeguardParseWarning {
  line: string;
  line_number: number;
  message: string;
}

export interface SafeguardWithParse extends SafeguardRow {
  rules: SafeguardParsedRule[];
  warnings: SafeguardParseWarning[];
}

export interface SafeguardPreview {
  rule_count: number;
  rules: SafeguardParsedRule[];
  warnings: SafeguardParseWarning[];
  content_hash: string;
}

export interface SafeguardUpsert {
  scope_kind: SafeguardScopeKind;
  scope_id?: string | null;
  content_md: string;
}

// ---------- Skills + skill drafts (Phase 5b / Sprint 5.3) ------------------

export type SkillDraftStatus = "draft" | "promoted" | "rejected";

export interface SkillStep {
  n: number;
  instruction: string;
  tool: string | null;
}

export interface SkillRow {
  id: string;
  org_id: string | null;
  slug: string;
  version: number;
  scope: string;
  agent_kind: string;
  title: string;
  description: string | null;
  side_effects: string;
  enabled: boolean;
  source_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillDraftRow {
  id: string;
  org_id: string;
  source_document_id: string | null;
  title: string;
  description: string | null;
  agent_kind: string;
  proposed_slug: string;
  steps: SkillStep[];
  inferred_tools: string[];
  params_schema: Record<string, unknown>;
  status: SkillDraftStatus;
  promoted_skill_id: string | null;
  warnings: string[];
  llm_provider: string | null;
  llm_model: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillDraftPatch {
  title?: string;
  description?: string | null;
  agent_kind?: string;
  proposed_slug?: string;
  steps?: SkillStep[];
  inferred_tools?: string[];
  params_schema?: Record<string, unknown>;
}

export interface SkillDraftPromoteResult {
  skill_id: string;
  version: number;
}

// ---------- Connectors (Phase 5b / Sprint 5.4) -----------------------------

export type ConnectorProviderKey =
  | "manual_paste"
  | "url_poll"
  | "slack"
  | "gdrive"
  | "zoom"
  | "hubspot"
  | "notion";

export type ConnectorProviderStatus = "ready" | "needs_oauth" | "stub";

export interface ConnectorProviderInfo {
  key: ConnectorProviderKey;
  label: string;
  hint: string;
  status: ConnectorProviderStatus;
  config_schema: Record<string, unknown>;
}

export interface ConnectorRow {
  id: string;
  org_id: string;
  provider: ConnectorProviderKey;
  name: string;
  scope: "personal" | "company" | "shared";
  nango_connection_id: string | null;
  config: Record<string, unknown>;
  refresh_interval_seconds: number;
  last_synced_at: string | null;
  last_status: string | null;
  last_error: string | null;
  consecutive_failures: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConnectorCreate {
  provider: ConnectorProviderKey;
  name: string;
  scope?: "personal" | "company" | "shared";
  nango_connection_id?: string | null;
  config?: Record<string, unknown>;
  refresh_interval_seconds?: number;
}

export interface ConnectorPatch {
  name?: string;
  scope?: "personal" | "company" | "shared";
  nango_connection_id?: string | null;
  config?: Record<string, unknown>;
  refresh_interval_seconds?: number;
  enabled?: boolean;
}

export interface ConnectorPasteBody {
  external_id: string;
  title: string;
  content_md: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface ConnectorSyncResult {
  status: "ok" | "no_op" | "failed";
  artifacts_added: number;
  artifacts_updated: number;
  artifacts_unchanged: number;
  warnings: string[];
  error: string | null;
}

export interface ConnectorPasteResult {
  document_id: string;
  action: "added" | "updated" | "unchanged";
}

export interface ConnectorArtifactRow {
  id: string;
  external_id: string;
  document_id: string | null;
  content_hash: string | null;
  last_seen_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ---------- Outcomes (Phase 5b / Sprint 5.5) -------------------------------

export type OutcomeMetricDirection =
  | "higher_is_better"
  | "lower_is_better"
  | "informational";

export type OutcomeMetricSource = "manual" | "webhook" | "derived" | "agent";

export interface OutcomeRow {
  id: string;
  org_id: string;
  run_id: string | null;
  goal_id: string | null;
  agent_kind: string | null;
  skill_slug: string | null;
  output_kind: string;
  title: string;
  content_md: string;
  content_hash: string;
  char_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OutcomeMetricRow {
  id: string;
  outcome_id: string;
  name: string;
  value: string; // numeric arrives as string from pg
  unit: string | null;
  direction: OutcomeMetricDirection;
  source: OutcomeMetricSource;
  recorded_at: string;
  metadata: Record<string, unknown>;
}

export interface OutcomeWithMetrics extends OutcomeRow {
  metrics: OutcomeMetricRow[];
}

export interface OutcomeCreateBody {
  run_id?: string | null;
  goal_id?: string | null;
  agent_kind?: string | null;
  skill_slug?: string | null;
  output_kind: string;
  title: string;
  content_md: string;
  metadata?: Record<string, unknown>;
}

export interface OutcomeMetricCreateBody {
  name: string;
  value: number;
  unit?: string | null;
  direction?: OutcomeMetricDirection;
  source?: OutcomeMetricSource;
  metadata?: Record<string, unknown>;
}

export interface SimilarOutcome {
  outcome_id: string;
  score: number;
  has_feedback: boolean;
  metric_count: number;
  title: string;
  content_md: string;
  output_kind: string;
  created_at: string;
}

// ---------- Swarms / subtasks (Phase 5b / Sprint 5.6) ----------------------

export type SubtaskStatus =
  | "pending"
  | "ready"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface SubtaskRow {
  id: string;
  org_id: string;
  goal_id: string;
  ordinal: number;
  title: string;
  instruction: string;
  agent_kind: string;
  skill_slug: string | null;
  depends_on: string[];
  status: SubtaskStatus;
  run_id: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SwarmPlanResult {
  subtasks: SubtaskRow[];
  warnings: string[];
  llm_provider: string | null;
  llm_model: string | null;
}

export interface SwarmDispatchResult {
  queued_subtask_ids: string[];
  queued_run_ids: string[];
}

// ---------- Briefings + heartbeat + activity (Phase 4 / front door) -------

export type BriefingKind = "daily" | "weekly" | "on_demand";

export interface BriefingSources {
  period_start: string;
  period_end: string;
  hours: number;
  goal_count: number;
  active_goal_count: number;
  decision_count: number;
  run_count: number;
  audit_count: number;
  [k: string]: unknown;
}

export interface BriefingRow {
  id: string;
  org_id: string;
  user_id: string | null;
  kind: BriefingKind;
  generated_at: string;
  period_start: string | null;
  period_end: string | null;
  summary_md: string;
  sources: BriefingSources;
  audio_url: string | null;
}

export interface BriefingGenerateBody {
  kind?: BriefingKind;
  period_hours?: number;
}

export interface HeartbeatPoint {
  date: string;
  value: number;
}

export interface HeartbeatSeries {
  kpi: string;
  label: string;
  unit: string;
  points: HeartbeatPoint[];
}

export interface HeartbeatResponse {
  period_days: number;
  period_start: string;
  period_end: string;
  series: HeartbeatSeries[];
}

export interface GoalsSummary {
  total: number;
  by_kind: { ephemeral: number; standing: number; routine: number; decision: number };
  by_status: {
    draft: number;
    active: number;
    paused: number;
    achieved: number;
    archived: number;
  };
  stalled_count: number;
}

export interface ActivityRow {
  run_id: string;
  goal_id: string;
  goal_title: string;
  goal_kind: string;
  agent_id: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  duration_ms: number | null;
  subtask_title: string | null;
}

// ---------- Captures (Phase 4 / capture-first composer) -------------------

export type CaptureSource = "text" | "email" | "voice" | "image" | "webhook";

export interface CaptureCreateBody {
  raw_content: string;
  source?: CaptureSource;
  /** Force a goal kind, skipping the classifier. */
  kind?: GoalKind;
  metadata?: Record<string, unknown>;
}

export interface CaptureIntent {
  kind: GoalKind;
  title: string;
  description?: string;
  cron_expr?: string;
  due_at?: string;
  target_value?: string;
}

export interface CaptureResult {
  capture_id: string;
  goal_id: string;
  intent: CaptureIntent;
  created_at: string;
  kr_id?: string;
}

// ---------- Departments + whoami ------------------------------------------

export interface Department {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  active_goal_count: number;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
  created_at: string;
}

export interface Whoami {
  org: { id: string; slug: string | null; name: string | null };
  role: string;
  department: { id: string; name: string } | null;
  goal_id: string | null;
}

export interface DispatchOk {
  run_id: string;
  status: "queued";
}

export interface DispatchAllOk {
  run_ids: string[];
  queued: number;
}

export interface SimulationReport {
  would_execute: unknown[];
  would_have_mutated: unknown[];
}

export interface DispatchSimulated {
  mode: "simulation";
  report: SimulationReport;
}

export type DispatchResult = DispatchOk | DispatchSimulated;
export type DispatchAllResult = DispatchAllOk | DispatchSimulated;

export interface ApiError {
  error: string;
  details?: unknown;
  hint?: string;
}
