/**
 * Typed API client for the Paperclip REST surface.
 *
 * No runtime deps; just `fetch`. Wraps every call in a tiny error-shaped
 * promise — caller sees `ApiError` thrown if the server returned a JSON
 * `{error: ...}` payload, otherwise the parsed body.
 *
 * Construct via `createApiClient({ baseUrl, orgSlug })`. Pass the
 * resulting object around (or instantiate once at app boot).
 */

import type {
  AgentState,
  AgentSummary,
  ApiError,
  AuditEntry,
  AuditQuery,
  AutonomyModeRow,
  AutonomyModeUpsert,
  AutonomyResolved,
  BrainGraph,
  CaptureCreateBody,
  CaptureResult,
  ConnectorArtifactRow,
  ConnectorCreate,
  ConnectorPasteBody,
  ConnectorPasteResult,
  ConnectorPatch,
  ConnectorProviderInfo,
  ConnectorRow,
  ConnectorSyncResult,
  Department,
  DispatchAllResult,
  DispatchResult,
  Goal,
  GoalCreate,
  GoalListQuery,
  GoalPatch,
  GoalWithDetail,
  InboxItem,
  InboxSummary,
  KeyResult,
  KeyResultCreate,
  KeyResultPatch,
  Organization,
  OutcomeCreateBody,
  OutcomeMetricCreateBody,
  OutcomeMetricRow,
  OutcomeRow,
  OutcomeWithMetrics,
  Run,
  RunDispatch,
  SafeguardPreview,
  SafeguardRow,
  SafeguardUpsert,
  SafeguardWithParse,
  SkillDraftPatch,
  SkillDraftPromoteResult,
  SkillDraftRow,
  SkillDraftStatus,
  SkillRow,
  SimilarOutcome,
  SubtaskRow,
  SwarmDispatchResult,
  SwarmPlanResult,
  Whoami,
} from "./types.js";

export interface ApiClientOpts {
  /** Base URL of the Paperclip API, e.g. `http://localhost:3001`. No trailing slash. */
  baseUrl: string;
  /** Optional org slug forwarded as the `X-BC-Org-Slug` header. */
  orgSlug?: string;
  /** Override the global `fetch` (handy in tests). */
  fetcher?: typeof fetch;
}

export class ApiCallError extends Error {
  readonly status: number;
  readonly body: ApiError | null;
  constructor(status: number, body: ApiError | null, message?: string) {
    super(message ?? body?.error ?? `request failed (${status})`);
    this.name = "ApiCallError";
    this.status = status;
    this.body = body;
  }
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export interface ApiClient {
  // -- Captures (capture-first composer) ----
  createCapture(body: CaptureCreateBody): Promise<CaptureResult>;
  // -- Goals ----
  listGoals(query?: GoalListQuery): Promise<Goal[]>;
  getGoal(id: string): Promise<GoalWithDetail>;
  createGoal(body: GoalCreate): Promise<Goal>;
  patchGoal(id: string, body: GoalPatch): Promise<Goal>;
  archiveGoal(id: string): Promise<Goal>;
  planGoal(id: string): Promise<{ subtasks: unknown[] }>;
  dispatchGoal(id: string, body: RunDispatch): Promise<DispatchResult>;
  dispatchAllForGoal(id: string, mode?: "live" | "simulation"): Promise<DispatchAllResult>;
  // -- Runs ----
  listRuns(opts?: { goalId?: string }): Promise<Run[]>;
  getRun(id: string): Promise<Run>;
  cancelRun(id: string): Promise<Run>;
  // -- Audit ----
  listAudit(query?: AuditQuery): Promise<AuditEntry[]>;
  // -- Agents ----
  listAgents(opts?: { isActive?: boolean }): Promise<AgentSummary[]>;
  getAgentState(id: string): Promise<AgentState>;
  // -- Key results ----
  listKeyResults(goalId: string): Promise<KeyResult[]>;
  createKeyResult(goalId: string, body: KeyResultCreate): Promise<KeyResult>;
  updateKeyResult(id: string, body: KeyResultPatch): Promise<KeyResult>;
  deleteKeyResult(id: string): Promise<void>;
  // -- Brain ----
  getBrainGraph(opts?: { limit?: number; refresh?: boolean }): Promise<BrainGraph>;
  // -- Inbox ----
  listInbox(opts?: { limit?: number }): Promise<InboxItem[]>;
  inboxSummary(): Promise<InboxSummary>;
  acknowledgeInbox(goalId: string): Promise<{ runs_acknowledged: number }>;
  // -- Org + departments + whoami ----
  getOrgBySlug(slug: string): Promise<Organization>;
  listDepartments(): Promise<Department[]>;
  whoami(): Promise<Whoami>;
  // -- Autonomy (Phase 5b / Sprint 5.1) ----
  listAutonomy(): Promise<AutonomyModeRow[]>;
  upsertAutonomy(body: AutonomyModeUpsert): Promise<AutonomyModeRow>;
  deleteAutonomy(id: string): Promise<void>;
  resolveAutonomy(opts?: { departmentId?: string; agentId?: string; skillId?: string }): Promise<AutonomyResolved>;
  // -- Safeguards (Phase 5b / Sprint 5.2) ----
  listSafeguards(): Promise<SafeguardRow[]>;
  getSafeguard(id: string): Promise<SafeguardRow>;
  upsertSafeguard(body: SafeguardUpsert): Promise<SafeguardWithParse>;
  deleteSafeguard(id: string): Promise<void>;
  previewSafeguards(content_md: string): Promise<SafeguardPreview>;
  // -- Skills + skill drafts (Phase 5b / Sprint 5.3) ----
  listSkills(): Promise<SkillRow[]>;
  generateSkillDraft(documentId: string): Promise<SkillDraftRow>;
  listSkillDrafts(opts?: { status?: SkillDraftStatus; limit?: number }): Promise<SkillDraftRow[]>;
  getSkillDraft(id: string): Promise<SkillDraftRow>;
  patchSkillDraft(id: string, body: SkillDraftPatch): Promise<SkillDraftRow>;
  promoteSkillDraft(id: string): Promise<SkillDraftPromoteResult>;
  rejectSkillDraft(id: string): Promise<void>;
  // -- Swarms / subtasks (Phase 5b / Sprint 5.6) ----
  planSwarm(goalId: string): Promise<SwarmPlanResult>;
  listSubtasks(goalId: string): Promise<SubtaskRow[]>;
  dispatchSwarm(goalId: string, opts?: { replan?: boolean }): Promise<SwarmDispatchResult>;
  cancelSubtask(id: string): Promise<void>;
  // -- Outcomes (Phase 5b / Sprint 5.5) ----
  recordOutcome(runId: string, body: OutcomeCreateBody): Promise<OutcomeRow>;
  listOutcomes(opts?: { skillSlug?: string; agentKind?: string; outputKind?: string; limit?: number }): Promise<OutcomeRow[]>;
  getOutcome(id: string): Promise<OutcomeWithMetrics>;
  recordOutcomeMetric(outcomeId: string, body: OutcomeMetricCreateBody): Promise<OutcomeMetricRow>;
  listOutcomeMetrics(outcomeId: string): Promise<OutcomeMetricRow[]>;
  similarOutcomes(opts: { skillSlug?: string; agentKind?: string; outputKind?: string; topN?: number; poolSize?: number }): Promise<SimilarOutcome[]>;
  deleteOutcome(id: string): Promise<void>;
  // -- Connectors (Phase 5b / Sprint 5.4) ----
  listConnectorProviders(): Promise<{ providers: ConnectorProviderInfo[] }>;
  listConnectors(): Promise<ConnectorRow[]>;
  getConnector(id: string): Promise<ConnectorRow>;
  createConnector(body: ConnectorCreate): Promise<ConnectorRow>;
  patchConnector(id: string, body: ConnectorPatch): Promise<ConnectorRow>;
  deleteConnector(id: string): Promise<void>;
  syncConnector(id: string): Promise<ConnectorSyncResult>;
  pasteConnector(id: string, body: ConnectorPasteBody): Promise<ConnectorPasteResult>;
  listConnectorArtifacts(id: string): Promise<ConnectorArtifactRow[]>;
}

export function createApiClient(opts: ApiClientOpts): ApiClient {
  const fetcher = opts.fetcher ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.orgSlug) headers["X-BC-Org-Slug"] = opts.orgSlug;

  async function request<T>(
    method: string,
    path: string,
    body?: Json,
  ): Promise<T> {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetcher(`${base}${path}`, init);
    if (res.status === 204) return undefined as unknown as T;

    const ct = res.headers.get("content-type") ?? "";
    let parsed: unknown = null;
    if (ct.includes("application/json")) {
      try { parsed = await res.json(); } catch { parsed = null; }
    } else {
      // Surface non-JSON body as a string in the error.
      try { parsed = await res.text(); } catch { parsed = null; }
    }

    if (!res.ok) {
      const apiError =
        parsed && typeof parsed === "object" && "error" in parsed
          ? (parsed as ApiError)
          : { error: typeof parsed === "string" ? parsed : "request_failed" };
      throw new ApiCallError(res.status, apiError);
    }
    return parsed as T;
  }

  function qs(query?: Record<string, string | number | boolean | undefined>): string {
    if (!query) return "";
    const parts: string[] = [];
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return parts.length ? `?${parts.join("&")}` : "";
  }

  return {
    createCapture: (body) =>
      request<CaptureResult>("POST", "/api/capture", body as unknown as Json),
    listGoals: (query) =>
      request<Goal[]>("GET", `/api/goals${qs(query as Record<string, string | number>)}`),
    getGoal: (id) => request<GoalWithDetail>("GET", `/api/goals/${encodeURIComponent(id)}`),
    createGoal: (body) =>
      request<Goal>("POST", "/api/goals", body as unknown as Json),
    patchGoal: (id, body) =>
      request<Goal>("PATCH", `/api/goals/${encodeURIComponent(id)}`, body as unknown as Json),
    archiveGoal: (id) =>
      request<Goal>("DELETE", `/api/goals/${encodeURIComponent(id)}`),
    planGoal: (id) =>
      request<{ subtasks: unknown[] }>("POST", `/api/goals/${encodeURIComponent(id)}/plan`),
    dispatchGoal: (id, body) =>
      request<DispatchResult>(
        "POST",
        `/api/goals/${encodeURIComponent(id)}/dispatch`,
        body as unknown as Json,
      ),
    dispatchAllForGoal: (id, mode = "live") =>
      request<DispatchAllResult>(
        "POST",
        `/api/goals/${encodeURIComponent(id)}/dispatch-all`,
        { mode } as unknown as Json,
      ),
    listRuns: (params) =>
      request<Run[]>(
        "GET",
        `/api/runs${qs(params?.goalId ? { goal_id: params.goalId } : undefined)}`,
      ),
    getRun: (id) => request<Run>("GET", `/api/runs/${encodeURIComponent(id)}`),
    cancelRun: (id) => request<Run>("POST", `/api/runs/${encodeURIComponent(id)}/cancel`),
    listAudit: (query) =>
      request<AuditEntry[]>("GET", `/api/audit${qs(query as Record<string, string | number>)}`),
    listAgents: (params) =>
      request<AgentSummary[]>(
        "GET",
        `/api/agents${qs(params?.isActive !== undefined ? { is_active: String(params.isActive) } : undefined)}`,
      ),
    getAgentState: (id) =>
      request<AgentState>("GET", `/api/agents/${encodeURIComponent(id)}/state`),
    listKeyResults: (goalId) =>
      request<KeyResult[]>(
        "GET",
        `/api/goals/${encodeURIComponent(goalId)}/key-results`,
      ),
    createKeyResult: (goalId, body) =>
      request<KeyResult>(
        "POST",
        `/api/goals/${encodeURIComponent(goalId)}/key-results`,
        body as unknown as Json,
      ),
    updateKeyResult: (id, body) =>
      request<KeyResult>(
        "PATCH",
        `/api/key-results/${encodeURIComponent(id)}`,
        body as unknown as Json,
      ),
    deleteKeyResult: (id) =>
      request<void>("DELETE", `/api/key-results/${encodeURIComponent(id)}`),
    getBrainGraph: (opts) =>
      request<BrainGraph>(
        "GET",
        `/api/brain/graph${qs({
          limit: opts?.limit,
          refresh: opts?.refresh ? "true" : undefined,
        })}`,
      ),
    listInbox: (opts) =>
      request<InboxItem[]>("GET", `/api/inbox${qs({ limit: opts?.limit })}`),
    inboxSummary: () => request<InboxSummary>("GET", "/api/inbox/summary"),
    acknowledgeInbox: (goalId) =>
      request<{ runs_acknowledged: number }>(
        "POST",
        `/api/inbox/acknowledge/${encodeURIComponent(goalId)}`,
      ),
    getOrgBySlug: (slug) =>
      request<Organization>("GET", `/api/orgs/by-slug/${encodeURIComponent(slug)}`),
    listDepartments: () => request<Department[]>("GET", "/api/departments"),
    whoami: () => request<Whoami>("GET", "/api/whoami"),
    listAutonomy: () => request<AutonomyModeRow[]>("GET", "/api/autonomy"),
    upsertAutonomy: (body) =>
      request<AutonomyModeRow>("PUT", "/api/autonomy", body as unknown as Json),
    deleteAutonomy: (id) =>
      request<void>("DELETE", `/api/autonomy/${encodeURIComponent(id)}`),
    resolveAutonomy: (opts) =>
      request<AutonomyResolved>(
        "GET",
        `/api/autonomy/resolve${qs({
          department_id: opts?.departmentId,
          agent_id: opts?.agentId,
          skill_id: opts?.skillId,
        })}`,
      ),
    listSafeguards: () => request<SafeguardRow[]>("GET", "/api/safeguards"),
    getSafeguard: (id) =>
      request<SafeguardRow>("GET", `/api/safeguards/${encodeURIComponent(id)}`),
    upsertSafeguard: (body) =>
      request<SafeguardWithParse>("PUT", "/api/safeguards", body as unknown as Json),
    deleteSafeguard: (id) =>
      request<void>("DELETE", `/api/safeguards/${encodeURIComponent(id)}`),
    previewSafeguards: (content_md) =>
      request<SafeguardPreview>("POST", "/api/safeguards/preview", { content_md }),
    listSkills: () => request<SkillRow[]>("GET", "/api/skills"),
    generateSkillDraft: (documentId) =>
      request<SkillDraftRow>(
        "POST",
        `/api/documents/${encodeURIComponent(documentId)}/draft-skill`,
      ),
    listSkillDrafts: (opts) =>
      request<SkillDraftRow[]>(
        "GET",
        `/api/skill-drafts${qs({ status: opts?.status, limit: opts?.limit })}`,
      ),
    getSkillDraft: (id) =>
      request<SkillDraftRow>("GET", `/api/skill-drafts/${encodeURIComponent(id)}`),
    patchSkillDraft: (id, body) =>
      request<SkillDraftRow>(
        "PATCH",
        `/api/skill-drafts/${encodeURIComponent(id)}`,
        body as unknown as Json,
      ),
    promoteSkillDraft: (id) =>
      request<SkillDraftPromoteResult>(
        "POST",
        `/api/skill-drafts/${encodeURIComponent(id)}/promote`,
      ),
    rejectSkillDraft: (id) =>
      request<void>(
        "POST",
        `/api/skill-drafts/${encodeURIComponent(id)}/reject`,
      ),
    planSwarm: (goalId) =>
      request<SwarmPlanResult>(
        "POST",
        `/api/goals/${encodeURIComponent(goalId)}/plan-swarm`,
      ),
    listSubtasks: (goalId) =>
      request<SubtaskRow[]>(
        "GET",
        `/api/goals/${encodeURIComponent(goalId)}/subtasks`,
      ),
    dispatchSwarm: (goalId, opts) =>
      request<SwarmDispatchResult>(
        "POST",
        `/api/goals/${encodeURIComponent(goalId)}/dispatch-swarm`,
        { replan: opts?.replan ?? false } as unknown as Json,
      ),
    cancelSubtask: (id) =>
      request<void>("POST", `/api/subtasks/${encodeURIComponent(id)}/cancel`),
    recordOutcome: (runId, body) =>
      request<OutcomeRow>(
        "POST",
        `/api/runs/${encodeURIComponent(runId)}/outcomes`,
        body as unknown as Json,
      ),
    listOutcomes: (opts) =>
      request<OutcomeRow[]>(
        "GET",
        `/api/outcomes${qs({
          skill_slug: opts?.skillSlug,
          agent_kind: opts?.agentKind,
          output_kind: opts?.outputKind,
          limit: opts?.limit,
        })}`,
      ),
    getOutcome: (id) =>
      request<OutcomeWithMetrics>("GET", `/api/outcomes/${encodeURIComponent(id)}`),
    recordOutcomeMetric: (outcomeId, body) =>
      request<OutcomeMetricRow>(
        "POST",
        `/api/outcomes/${encodeURIComponent(outcomeId)}/metrics`,
        body as unknown as Json,
      ),
    listOutcomeMetrics: (outcomeId) =>
      request<OutcomeMetricRow[]>(
        "GET",
        `/api/outcomes/${encodeURIComponent(outcomeId)}/metrics`,
      ),
    similarOutcomes: (opts) =>
      request<SimilarOutcome[]>(
        "GET",
        `/api/outcomes/similar${qs({
          skill_slug: opts.skillSlug,
          agent_kind: opts.agentKind,
          output_kind: opts.outputKind,
          top_n: opts.topN,
          pool_size: opts.poolSize,
        })}`,
      ),
    deleteOutcome: (id) =>
      request<void>("DELETE", `/api/outcomes/${encodeURIComponent(id)}`),
    listConnectorProviders: () =>
      request<{ providers: ConnectorProviderInfo[] }>("GET", "/api/connectors/providers"),
    listConnectors: () => request<ConnectorRow[]>("GET", "/api/connectors"),
    getConnector: (id) =>
      request<ConnectorRow>("GET", `/api/connectors/${encodeURIComponent(id)}`),
    createConnector: (body) =>
      request<ConnectorRow>("POST", "/api/connectors", body as unknown as Json),
    patchConnector: (id, body) =>
      request<ConnectorRow>(
        "PATCH",
        `/api/connectors/${encodeURIComponent(id)}`,
        body as unknown as Json,
      ),
    deleteConnector: (id) =>
      request<void>("DELETE", `/api/connectors/${encodeURIComponent(id)}`),
    syncConnector: (id) =>
      request<ConnectorSyncResult>(
        "POST",
        `/api/connectors/${encodeURIComponent(id)}/sync`,
      ),
    pasteConnector: (id, body) =>
      request<ConnectorPasteResult>(
        "POST",
        `/api/connectors/${encodeURIComponent(id)}/paste`,
        body as unknown as Json,
      ),
    listConnectorArtifacts: (id) =>
      request<ConnectorArtifactRow[]>(
        "GET",
        `/api/connectors/${encodeURIComponent(id)}/artifacts`,
      ),
  };
}
