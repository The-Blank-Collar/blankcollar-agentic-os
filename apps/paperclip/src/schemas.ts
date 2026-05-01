/** Zod schemas. Wire formats match `docs/API.md`. */

import { z } from "zod";

export const RoleKind = z.enum([
  "owner",
  "department_lead",
  "team_member",
  "auditor",
  "agent",
]);
export type RoleKind = z.infer<typeof RoleKind>;

export const GoalStatus = z.enum(["draft", "active", "paused", "achieved", "archived"]);
export type GoalStatus = z.infer<typeof GoalStatus>;

export const GoalKind = z.enum(["ephemeral", "standing", "routine", "decision"]);
export type GoalKind = z.infer<typeof GoalKind>;

export const BriefingKind = z.enum(["daily", "weekly", "on_demand"]);
export type BriefingKind = z.infer<typeof BriefingKind>;

export const CaptureSource = z.enum(["text", "email", "voice", "image", "webhook"]);
export type CaptureSource = z.infer<typeof CaptureSource>;

export const RunStatus = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const Scope = z
  .object({
    org_id: z.string().uuid(),
    department_id: z.string().uuid().nullable().optional(),
    goal_id: z.string().uuid().nullable().optional(),
    role: RoleKind,
  })
  .strict();
export type Scope = z.infer<typeof Scope>;

// ---------- Goals ---------------------------------------------------------

export const GoalCreate = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(5_000).optional(),
    department_id: z.string().uuid().nullable().optional(),
    kind: GoalKind.optional(),
    cron_expr: z.string().max(120).nullable().optional(),
    due_at: z.string().datetime().nullable().optional(),
    target_value: z.string().max(200).nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();
export type GoalCreate = z.infer<typeof GoalCreate>;

export const GoalPatch = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5_000).optional(),
    kind: GoalKind.optional(),
    cron_expr: z.string().max(120).nullable().optional(),
    due_at: z.string().datetime().nullable().optional(),
    progress: z.number().min(0).max(100).nullable().optional(),
    target_value: z.string().max(200).nullable().optional(),
    actual_value: z.string().max(200).nullable().optional(),
    delta_label: z.string().max(120).nullable().optional(),
    track_state: z.string().max(40).nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
    status: GoalStatus.optional(),
  })
  .strict();
export type GoalPatch = z.infer<typeof GoalPatch>;

export const GoalListQuery = z
  .object({
    status: GoalStatus.optional(),
    kind: GoalKind.optional(),
    department_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type GoalListQuery = z.infer<typeof GoalListQuery>;

// ---------- Key Results --------------------------------------------------

export const KeyResultCreate = z
  .object({
    label: z.string().min(1).max(200),
    target_value: z.string().max(200).nullable().optional(),
    current_value: z.string().max(200).nullable().optional(),
    unit: z.string().max(40).nullable().optional(),
    weight: z.number().nonnegative().max(100).optional(),
    due_at: z.string().datetime().nullable().optional(),
  })
  .strict();
export type KeyResultCreate = z.infer<typeof KeyResultCreate>;

export const KeyResultPatch = z
  .object({
    label: z.string().min(1).max(200).optional(),
    target_value: z.string().max(200).nullable().optional(),
    current_value: z.string().max(200).nullable().optional(),
    unit: z.string().max(40).nullable().optional(),
    weight: z.number().nonnegative().max(100).optional(),
    due_at: z.string().datetime().nullable().optional(),
  })
  .strict();
export type KeyResultPatch = z.infer<typeof KeyResultPatch>;

// ---------- Briefings ----------------------------------------------------

export const BriefingGenerate = z
  .object({
    kind: BriefingKind.default("on_demand"),
    period_hours: z.number().int().min(1).max(24 * 14).optional(),
  })
  .strict();
export type BriefingGenerate = z.infer<typeof BriefingGenerate>;

export const BriefingListQuery = z
  .object({
    kind: BriefingKind.optional(),
    limit: z.coerce.number().int().min(1).max(60).default(14),
  })
  .strict();
export type BriefingListQuery = z.infer<typeof BriefingListQuery>;

// ---------- Decisions ----------------------------------------------------

export const DecisionResolution = z.enum(["approved", "declined"]);
export type DecisionResolution = z.infer<typeof DecisionResolution>;

export const DecisionResolve = z
  .object({
    resolution: DecisionResolution,
    note: z.string().max(2_000).optional(),
  })
  .strict();
export type DecisionResolve = z.infer<typeof DecisionResolve>;

// ---------- Captures -----------------------------------------------------

// What the user actually says. Always natural language; never "create a goal".
export const CaptureCreate = z
  .object({
    raw_content: z.string().min(1).max(8_000),
    source: CaptureSource.default("text"),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();
export type CaptureCreate = z.infer<typeof CaptureCreate>;

// ---------- Runs ----------------------------------------------------------

export const RunDispatch = z
  .object({
    subtask_index: z.number().int().min(0),
    agent_id: z.string().uuid().optional(),
  })
  .strict();
export type RunDispatch = z.infer<typeof RunDispatch>;

// ---------- Agents --------------------------------------------------------

export const AgentCreate = z
  .object({
    kind: z.string().min(1).max(50),
    name: z.string().min(1).max(120),
    config: z.record(z.unknown()).default({}),
  })
  .strict();
export type AgentCreate = z.infer<typeof AgentCreate>;

export const AgentPatch = z
  .object({
    name: z.string().min(1).max(120).optional(),
    config: z.record(z.unknown()).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();
export type AgentPatch = z.infer<typeof AgentPatch>;

// ---------- Audit ---------------------------------------------------------

export const AuditQuery = z
  .object({
    action: z.string().optional(),
    target_type: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
export type AuditQuery = z.infer<typeof AuditQuery>;
