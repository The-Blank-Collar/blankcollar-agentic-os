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
