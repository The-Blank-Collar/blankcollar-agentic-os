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
    // Filter to active/draft goals whose most-recent run is older than N days
    // (or have no runs at all and were created > N days ago). Backs the
    // "stalled" report — what isn't moving?
    stalled_for_days: z.coerce.number().int().min(1).max(365).optional(),
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
// `kind` lets the caller pin the resulting goal kind (and skip the classifier
// for that decision) — useful when the user knows what they want.
export const CaptureCreate = z
  .object({
    raw_content: z.string().min(1).max(8_000),
    source: CaptureSource.default("text"),
    kind: GoalKind.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();
export type CaptureCreate = z.infer<typeof CaptureCreate>;

// ---------- Skills (Capabilities pillar) ---------------------------------

export const SkillScope = z.enum(["personal", "company", "shared"]);
export type SkillScope = z.infer<typeof SkillScope>;

export const SideEffects = z.enum(["read", "write", "external"]);
export type SideEffects = z.infer<typeof SideEffects>;

export const SkillManifest = z
  .object({
    id: z.string().min(1).max(120),
    version: z.number().int().min(1).default(1),
    scope: SkillScope.default("shared"),
    mode_aware: z.boolean().default(false),
    agent_kind: z.string().min(1).max(50),
    title: z.string().min(1).max(200),
    description: z.string().max(2_000).optional(),
    inputs: z.record(z.unknown()).default({}),
    side_effects: SideEffects.default("read"),
    permissions: z
      .object({
        required_role: RoleKind.optional(),
        approval_under: z.number().nonnegative().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type SkillManifest = z.infer<typeof SkillManifest>;

export const SkillListQuery = z
  .object({
    scope: SkillScope.optional(),
    agent_kind: z.string().optional(),
    enabled: z.coerce.boolean().optional(),
  })
  .strict();
export type SkillListQuery = z.infer<typeof SkillListQuery>;

// ---------- Routine triggers (Cadence pillar) ----------------------------

export const RoutineTriggerKind = z.enum(["schedule", "event", "api"]);
export type RoutineTriggerKind = z.infer<typeof RoutineTriggerKind>;

export const RoutineTriggerCreate = z
  .object({
    trigger_kind: RoutineTriggerKind,
    // For event triggers: { action: "decision.approve", match: { ... } }
    // For api triggers:   { endpoint_token: "secret-token" } (auto-generated if omitted)
    // For schedule:       { cron_expr: "0 9 * * 1" }
    trigger_spec: z.record(z.unknown()).default({}),
    enabled: z.boolean().default(true),
  })
  .strict();
export type RoutineTriggerCreate = z.infer<typeof RoutineTriggerCreate>;

export const RoutineTriggerPatch = z
  .object({
    trigger_spec: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type RoutineTriggerPatch = z.infer<typeof RoutineTriggerPatch>;

// ---------- Onboarding ----------------------------------------------------

export const OnboardingMode = z.enum(["single_user", "multi_user"]);
export type OnboardingMode = z.infer<typeof OnboardingMode>;

export const OnboardingStart = z
  .object({
    mode: OnboardingMode,
    user_email: z.string().email().optional(),
    user_name: z.string().max(120).optional(),
  })
  .strict();
export type OnboardingStart = z.infer<typeof OnboardingStart>;

export const OnboardingAnswer = z
  .object({
    question_id: z.string().min(1).max(40),
    answer: z.string().min(1).max(4_000),
  })
  .strict();
export type OnboardingAnswer = z.infer<typeof OnboardingAnswer>;

// ---------- Audit / Level-Up reports -------------------------------------

export const AuditReportKind = z.enum(["audit", "level_up"]);
export type AuditReportKind = z.infer<typeof AuditReportKind>;

export const AuditReportRunRequest = z
  .object({
    kind: AuditReportKind,
    period_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
    user_id: z.string().uuid().optional(), // multi-user: scope to one teammate
  })
  .strict();
export type AuditReportRunRequest = z.infer<typeof AuditReportRunRequest>;

// ---------- Knowledge wiki (Context pillar) ------------------------------

export const KnowledgeScope = z.enum(["personal", "company", "shared"]);
export type KnowledgeScope = z.infer<typeof KnowledgeScope>;

export const KnowledgeDocCreate = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9-_/.]*$/i, "slug must be url-safe"),
    title: z.string().min(1).max(200),
    scope: KnowledgeScope.default("company"),
    hot: z.boolean().default(false),
    content_md: z.string().min(1).max(200_000),
    tags: z.array(z.string().max(40)).max(40).default([]),
  })
  .strict();
export type KnowledgeDocCreate = z.infer<typeof KnowledgeDocCreate>;

export const KnowledgeDocPatch = z
  .object({
    title: z.string().min(1).max(200).optional(),
    scope: KnowledgeScope.optional(),
    hot: z.boolean().optional(),
    content_md: z.string().min(1).max(200_000).optional(),
    tags: z.array(z.string().max(40)).max(40).optional(),
  })
  .strict();
export type KnowledgeDocPatch = z.infer<typeof KnowledgeDocPatch>;

export const KnowledgeListQuery = z
  .object({
    scope: KnowledgeScope.optional(),
    hot: z.coerce.boolean().optional(),
    tag: z.string().max(40).optional(),
    q: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type KnowledgeListQuery = z.infer<typeof KnowledgeListQuery>;

// ---------- Approvals (Phase 5 foundation) -------------------------------

export const ApprovalUrgency = z.enum(["low", "normal", "urgent"]);
export type ApprovalUrgency = z.infer<typeof ApprovalUrgency>;

export const ApprovalResolution = z.enum(["approved", "declined", "expired"]);
export type ApprovalResolution = z.infer<typeof ApprovalResolution>;

export const ApprovalCreate = z
  .object({
    action_kind: z.string().min(1).max(120),
    proposal: z.record(z.unknown()).default({}),
    reason: z.string().max(2_000).optional(),
    urgency: ApprovalUrgency.default("normal"),
    goal_id: z.string().uuid().optional(),
    run_id: z.string().uuid().optional(),
    requesting_agent_id: z.string().uuid().optional(),
    expires_in_hours: z.number().int().min(1).max(24 * 30).optional(),
  })
  .strict();
export type ApprovalCreate = z.infer<typeof ApprovalCreate>;

export const ApprovalResolve = z
  .object({
    note: z.string().max(2_000).optional(),
  })
  .strict();
export type ApprovalResolve = z.infer<typeof ApprovalResolve>;

export const ApprovalListQuery = z
  .object({
    status: z.enum(["pending", "resolved", "all"]).default("pending"),
    urgency: ApprovalUrgency.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type ApprovalListQuery = z.infer<typeof ApprovalListQuery>;

// ---------- Policy ------------------------------------------------------

export const PolicyEffect = z.enum(["allow", "approve", "deny"]);
export type PolicyEffect = z.infer<typeof PolicyEffect>;

// ---------- Payments (Phase 9 safety primitives) -------------------------

export const SpendingPeriod = z.enum(["per_request", "daily", "weekly", "monthly"]);
export type SpendingPeriod = z.infer<typeof SpendingPeriod>;

export const PaymentSettingsPatch = z
  .object({
    enabled:             z.boolean().optional(),
    default_limit_cents: z.number().int().min(0).max(1_000_000_000_000).optional(),
    default_period:      SpendingPeriod.optional(),
    approval_threshold:  z.number().int().min(0).max(1_000_000_000_000).optional(),
    notify_email:        z.string().email().nullable().optional(),
  })
  .strict();
export type PaymentSettingsPatch = z.infer<typeof PaymentSettingsPatch>;

export const SpendingLimitCreate = z
  .object({
    agent_id:    z.string().uuid(),
    limit_cents: z.number().int().min(0).max(1_000_000_000_000),
    period:      SpendingPeriod.default("monthly"),
    category:    z.string().min(1).max(80).nullable().optional(),
  })
  .strict();
export type SpendingLimitCreate = z.infer<typeof SpendingLimitCreate>;

export const PaymentRequestCreate = z
  .object({
    agent_id:     z.string().uuid().nullable().optional(),
    goal_id:      z.string().uuid().nullable().optional(),
    run_id:       z.string().uuid().nullable().optional(),
    amount_cents: z.number().int().min(1).max(1_000_000_000_000),
    currency:     z.string().length(3).default("USD"),
    vendor:       z.string().min(1).max(200),
    category:     z.string().min(1).max(80).nullable().optional(),
    description:  z.string().min(1).max(2_000),
  })
  .strict();
export type PaymentRequestCreate = z.infer<typeof PaymentRequestCreate>;

export const KillSwitchToggle = z
  .object({
    reason: z.string().max(500).nullable().optional(),
  })
  .strict();
export type KillSwitchToggle = z.infer<typeof KillSwitchToggle>;

// ---------- Tool registry (MCP) -----------------------------------------

export const ToolTransport = z.enum(["stdio", "http", "sse", "websocket"]);
export type ToolTransport = z.infer<typeof ToolTransport>;

export const ToolManifest = z
  .object({
    id:           z.string().min(1).max(120),
    version:      z.number().int().min(1).default(1),
    scope:        SkillScope.default("shared"),
    name:         z.string().min(1).max(200),
    description:  z.string().max(2_000).optional(),
    transport:    ToolTransport,
    target:       z.string().min(1).max(500),
    env_keys:     z.array(z.string().min(1).max(120)).default([]),
    input_schema: z.record(z.unknown()).default({}),
  })
  .strict();
export type ToolManifest = z.infer<typeof ToolManifest>;

export const PolicyCreate = z
  .object({
    role:        RoleKind.nullable().optional(),
    agent_kind:  z.string().min(1).max(40).nullable().optional(),
    skill_slug:  z.string().min(1).max(120).nullable().optional(),
    action_kind: z.string().min(1).max(120).nullable().optional(),
    effect:      PolicyEffect,
    priority:    z.number().int().min(0).max(10_000).default(100),
    reason:      z.string().max(500).nullable().optional(),
  })
  .strict();
export type PolicyCreate = z.infer<typeof PolicyCreate>;

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
