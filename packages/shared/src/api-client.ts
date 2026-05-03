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
  BrainGraph,
  DispatchAllResult,
  DispatchResult,
  Goal,
  GoalCreate,
  GoalListQuery,
  GoalPatch,
  GoalWithDetail,
  KeyResult,
  KeyResultCreate,
  KeyResultPatch,
  Run,
  RunDispatch,
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
  };
}
