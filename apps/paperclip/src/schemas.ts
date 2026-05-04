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

// ---------- Document ingestion (Phase 2.4) ------------------------------

export const DocumentMarkdownCreate = z
  .object({
    title:           z.string().min(1).max(500),
    content_md:      z.string().min(1).max(1_000_000),
    source_url:      z.string().url().max(2_000).nullable().optional(),
    source_filename: z.string().min(1).max(255).nullable().optional(),
    mime_type:       z.string().min(1).max(120).default("text/markdown"),
    scope:           SkillScope.default("company"),
    tags:            z.array(z.string().min(1).max(40)).max(20).default([]),
    /**
     * When true, an existing document with the same content_hash is
     * deleted (cascading its chunks) and re-ingested. Useful for editing
     * a doc and re-uploading the updated version. Without --force,
     * an exact-content match returns the existing document_id.
     */
    force:           z.boolean().default(false),
    /** Optional chunker tuning — defaults to 1500/150/50. */
    target_chars:    z.number().int().min(200).max(8_000).optional(),
    overlap_chars:   z.number().int().min(0).max(2_000).optional(),
    min_chars:       z.number().int().min(0).max(2_000).optional(),
  })
  .strict();
export type DocumentMarkdownCreate = z.infer<typeof DocumentMarkdownCreate>;

// ---------- Upstream sources (Phase 2.5) --------------------------------

export const UpstreamSourceCreate = z
  .object({
    name:                     z.string().min(1).max(200),
    source_url:               z.string().url().max(2_000),
    scope:                    SkillScope.default("company"),
    tags:                     z.array(z.string().min(1).max(40)).max(20).default([]),
    refresh_interval_seconds: z.number().int().min(60).max(30 * 24 * 3_600).default(86_400),
  })
  .strict();
export type UpstreamSourceCreate = z.infer<typeof UpstreamSourceCreate>;

export const UpstreamSourcePatch = z
  .object({
    name:                     z.string().min(1).max(200).optional(),
    scope:                    SkillScope.optional(),
    tags:                     z.array(z.string().min(1).max(40)).max(20).optional(),
    refresh_interval_seconds: z.number().int().min(60).max(30 * 24 * 3_600).optional(),
    enabled:                  z.boolean().optional(),
  })
  .strict();
export type UpstreamSourcePatch = z.infer<typeof UpstreamSourcePatch>;

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
    /**
     * Tool name on the MCP server side. Defaults to the segment after
     * the last `.` in `id` (so `web.fetch` → `fetch`). Set explicitly
     * when the server-side tool name differs from the slug suffix.
     */
    tool_name:    z.string().min(1).max(120).optional(),
  })
  .strict();
export type ToolManifest = z.infer<typeof ToolManifest>;

export const ToolInvokeBody = z
  .object({
    input:  z.record(z.unknown()).default({}),
    run_id: z.string().uuid().nullable().optional(),
    /** Per-call timeout override in ms; capped server-side at 60s. */
    timeout_ms: z.number().int().min(1_000).max(60_000).optional(),
  })
  .strict();
export type ToolInvokeBody = z.infer<typeof ToolInvokeBody>;

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

export const RunMode = z.enum(["live", "simulation"]);
export type RunMode = z.infer<typeof RunMode>;

export const RunDispatch = z
  .object({
    subtask_index: z.number().int().min(0),
    agent_id: z.string().uuid().optional(),
    /** Phase 2.3.b: when 'simulation', no real runs are queued — the
     *  endpoint returns a "would have done" report instead. */
    mode: RunMode.default("live"),
  })
  .strict();
export type RunDispatch = z.infer<typeof RunDispatch>;

export const RunFeedbackCreate = z
  .object({
    rating: z.number().int().min(1).max(5),
    /** Canned + free tags. Convention: lowercase-hyphen.
     *  Common tags: wrong-tone, missing-fact, hallucinated, too-long,
     *  too-short, off-topic, perfect, helpful. */
    tags: z.array(z.string().min(1).max(40)).max(10).default([]),
    note: z.string().max(2_000).optional(),
  })
  .strict();
export type RunFeedbackCreate = z.infer<typeof RunFeedbackCreate>;

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

// ---------- Autonomy modes (Phase 5b / Sprint 5.1) ------------------------

export const AutonomyMode = z.enum([
  "planning",
  "auto_approve",
  "ask_every_time",
  "custom",
]);
export type AutonomyMode = z.infer<typeof AutonomyMode>;

export const AutonomyScopeKind = z.enum(["org", "department", "agent", "skill"]);
export type AutonomyScopeKind = z.infer<typeof AutonomyScopeKind>;

/**
 * Upsert a mode at a given scope. `scope_id` MUST be omitted/null when
 * `scope_kind === 'org'` and MUST be present otherwise (matches the SQL
 * CHECK constraint).
 */
export const AutonomyModeUpsert = z
  .object({
    scope_kind: AutonomyScopeKind,
    scope_id: z.string().uuid().nullable().optional(),
    mode: AutonomyMode,
    spending_cap_cents: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine(
    (d) => (d.scope_kind === "org" ? d.scope_id == null : d.scope_id != null),
    {
      message: "scope_id must be null for scope_kind='org' and present otherwise",
      path: ["scope_id"],
    },
  );
export type AutonomyModeUpsert = z.infer<typeof AutonomyModeUpsert>;

export const AutonomyResolveQuery = z
  .object({
    department_id: z.string().uuid().optional(),
    agent_id: z.string().uuid().optional(),
    skill_id: z.string().uuid().optional(),
  })
  .strict();
export type AutonomyResolveQuery = z.infer<typeof AutonomyResolveQuery>;

// ---------- Safeguards (Phase 5b / Sprint 5.2) ----------------------------

export const SafeguardScopeKind = z.enum(["org", "department", "agent"]);
export type SafeguardScopeKind = z.infer<typeof SafeguardScopeKind>;

export const SafeguardUpsert = z
  .object({
    scope_kind: SafeguardScopeKind,
    scope_id: z.string().uuid().nullable().optional(),
    content_md: z.string().min(0).max(100_000),
  })
  .strict()
  .refine(
    (d) => (d.scope_kind === "org" ? d.scope_id == null : d.scope_id != null),
    {
      message: "scope_id must be null for scope_kind='org' and present otherwise",
      path: ["scope_id"],
    },
  );
export type SafeguardUpsert = z.infer<typeof SafeguardUpsert>;

export const SafeguardPreview = z
  .object({
    content_md: z.string().min(0).max(100_000),
  })
  .strict();
export type SafeguardPreview = z.infer<typeof SafeguardPreview>;

// ---------- Skill drafts (Phase 5b / Sprint 5.3) --------------------------

export const SkillDraftStatus = z.enum(["draft", "promoted", "rejected"]);
export type SkillDraftStatus = z.infer<typeof SkillDraftStatus>;

export const SkillDraftPatch = z
  .object({
    title:          z.string().min(1).max(200).optional(),
    description:    z.string().max(5_000).nullable().optional(),
    agent_kind:     z.string().min(1).max(40).optional(),
    proposed_slug:  z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9._-]+$/, "slug must be lowercase [a-z0-9._-]")
      .optional(),
    steps:          z.array(z.record(z.unknown())).max(50).optional(),
    inferred_tools: z.array(z.string().max(120)).max(20).optional(),
    params_schema:  z.record(z.unknown()).optional(),
  })
  .strict();
export type SkillDraftPatch = z.infer<typeof SkillDraftPatch>;

export const SkillDraftListQuery = z
  .object({
    status: SkillDraftStatus.optional(),
    limit:  z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type SkillDraftListQuery = z.infer<typeof SkillDraftListQuery>;

// ---------- Connectors (Phase 5b / Sprint 5.4) ----------------------------

export const ConnectorProviderKey = z.enum([
  "manual_paste",
  "url_poll",
  "slack",
  "gdrive",
  "zoom",
  "hubspot",
  "notion",
]);
export type ConnectorProviderKey = z.infer<typeof ConnectorProviderKey>;

export const ConnectorCreate = z
  .object({
    provider:                 ConnectorProviderKey,
    name:                     z.string().min(1).max(200),
    scope:                    SkillScope.default("company"),
    nango_connection_id:      z.string().max(200).nullable().optional(),
    config:                   z.record(z.unknown()).default({}),
    refresh_interval_seconds: z.number().int().min(60).max(30 * 24 * 3_600).default(3_600),
  })
  .strict();
export type ConnectorCreate = z.infer<typeof ConnectorCreate>;

export const ConnectorPatch = z
  .object({
    name:                     z.string().min(1).max(200).optional(),
    scope:                    SkillScope.optional(),
    nango_connection_id:      z.string().max(200).nullable().optional(),
    config:                   z.record(z.unknown()).optional(),
    refresh_interval_seconds: z.number().int().min(60).max(30 * 24 * 3_600).optional(),
    enabled:                  z.boolean().optional(),
  })
  .strict();
export type ConnectorPatch = z.infer<typeof ConnectorPatch>;

export const ConnectorPaste = z
  .object({
    external_id:  z.string().min(1).max(200),
    title:        z.string().min(1).max(500),
    content_md:   z.string().min(1).max(1_000_000),
    metadata:     z.record(z.unknown()).optional(),
    tags:         z.array(z.string().min(1).max(40)).max(20).optional(),
  })
  .strict();
export type ConnectorPaste = z.infer<typeof ConnectorPaste>;

// ---------- Outcomes (Phase 5b / Sprint 5.5) -------------------------------

export const OutcomeMetricDirection = z.enum([
  "higher_is_better",
  "lower_is_better",
  "informational",
]);
export type OutcomeMetricDirection = z.infer<typeof OutcomeMetricDirection>;

export const OutcomeMetricSource = z.enum(["manual", "webhook", "derived", "agent"]);
export type OutcomeMetricSource = z.infer<typeof OutcomeMetricSource>;

export const OutcomeCreate = z
  .object({
    run_id:      z.string().uuid().nullable().optional(),
    goal_id:     z.string().uuid().nullable().optional(),
    agent_kind:  z.string().min(1).max(40).nullable().optional(),
    skill_slug:  z.string().min(1).max(120).nullable().optional(),
    output_kind: z.string().min(1).max(60),
    title:       z.string().min(1).max(500),
    content_md:  z.string().min(1).max(1_000_000),
    metadata:    z.record(z.unknown()).optional(),
  })
  .strict();
export type OutcomeCreate = z.infer<typeof OutcomeCreate>;

export const OutcomeListQuery = z
  .object({
    skill_slug:  z.string().min(1).max(120).optional(),
    agent_kind:  z.string().min(1).max(40).optional(),
    output_kind: z.string().min(1).max(60).optional(),
    limit:       z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type OutcomeListQuery = z.infer<typeof OutcomeListQuery>;

export const OutcomeMetricCreate = z
  .object({
    name:      z.string().min(1).max(80),
    value:     z.number().finite(),
    unit:      z.string().max(40).nullable().optional(),
    direction: OutcomeMetricDirection.default("higher_is_better"),
    source:    OutcomeMetricSource.default("manual"),
    metadata:  z.record(z.unknown()).optional(),
  })
  .strict();
export type OutcomeMetricCreate = z.infer<typeof OutcomeMetricCreate>;

export const OutcomeSimilarQuery = z
  .object({
    skill_slug:  z.string().min(1).max(120).optional(),
    agent_kind:  z.string().min(1).max(40).optional(),
    output_kind: z.string().min(1).max(60).optional(),
    top_n:       z.coerce.number().int().min(1).max(20).default(3),
    pool_size:   z.coerce.number().int().min(1).max(200).default(20),
  })
  .strict()
  .refine((d) => !!d.skill_slug || !!d.agent_kind, {
    message: "Provide at least one of skill_slug or agent_kind",
  });
export type OutcomeSimilarQuery = z.infer<typeof OutcomeSimilarQuery>;

// ---------- Swarms / Chief of Staff (Phase 5b / Sprint 5.6) ---------------

export const SwarmDispatchBody = z
  .object({
    /** When true, also re-runs the planner first. */
    replan: z.boolean().default(false),
  })
  .strict();
export type SwarmDispatchBody = z.infer<typeof SwarmDispatchBody>;

// ---------- Audit ---------------------------------------------------------

export const AuditQuery = z
  .object({
    action: z.string().optional(),
    target_type: z.string().optional(),
    /** Filter to a specific actor (user or agent) UUID. */
    actor_id: z.string().uuid().optional(),
    /** ISO timestamp; rows with created_at >= since. */
    since: z.string().datetime().optional(),
    /** ISO timestamp; rows with created_at < until. */
    until: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
export type AuditQuery = z.infer<typeof AuditQuery>;

// ---------- Invitations (Phase 6.b) ---------------------------------------

export const InvitationStatus = z.enum(["pending", "accepted", "revoked", "expired"]);
export type InvitationStatus = z.infer<typeof InvitationStatus>;

/** Roles invitable from the UI — `agent` is reserved for the system. */
export const InvitableRole = z.enum([
  "owner",
  "department_lead",
  "team_member",
  "auditor",
]);
export type InvitableRole = z.infer<typeof InvitableRole>;

export const InvitationCreate = z
  .object({
    email: z.string().email().max(320),
    role: InvitableRole.default("team_member"),
    department_id: z.string().uuid().nullable().optional(),
  })
  .strict();
export type InvitationCreate = z.infer<typeof InvitationCreate>;

export const InvitationListQuery = z
  .object({
    status: InvitationStatus.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type InvitationListQuery = z.infer<typeof InvitationListQuery>;

export const InvitationAccept = z
  .object({
    full_name: z.string().min(1).max(120).optional(),
  })
  .strict();
export type InvitationAccept = z.infer<typeof InvitationAccept>;
