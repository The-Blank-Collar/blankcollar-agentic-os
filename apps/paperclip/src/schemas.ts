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
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();
export type GoalCreate = z.infer<typeof GoalCreate>;

export const GoalPatch = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5_000).optional(),
    metadata: z.record(z.unknown()).optional(),
    status: GoalStatus.optional(),
  })
  .strict();
export type GoalPatch = z.infer<typeof GoalPatch>;

export const GoalListQuery = z
  .object({
    status: GoalStatus.optional(),
    department_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type GoalListQuery = z.infer<typeof GoalListQuery>;

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
