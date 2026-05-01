/**
 * Tiny typed HTTP client for the Paperclip API.
 *
 * Configuration:
 *   BC_API_URL    base URL of the Paperclip API (default: http://localhost:3000)
 *   BC_ORG_SLUG   slug to send as X-BC-Org-Slug (default: blankcollar-personal)
 *   BC_TOKEN      Bearer token, when Supabase auth is enforced (optional)
 *
 * Falls back to demo-org behaviour automatically — Paperclip's
 * resolveCallerScope() defaults to the demo org when no token is provided.
 */

const DEFAULT_BASE = "http://localhost:3000";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export type ClientOptions = {
  baseUrl?: string;
  orgSlug?: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

export class Client {
  baseUrl: string;
  orgSlug: string;
  token: string;
  fetchImpl: typeof fetch;

  constructor(opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.BC_API_URL ?? DEFAULT_BASE).replace(/\/$/, "");
    this.orgSlug = opts.orgSlug ?? process.env.BC_ORG_SLUG ?? "blankcollar-personal";
    this.token = opts.token ?? process.env.BC_TOKEN ?? "";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Builds an absolute URL with optional querystring. Exposed for tests. */
  buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): URL {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, this.baseUrl);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      "x-bc-org-slug": this.orgSlug,
    };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  async request<T = unknown>(args: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  }): Promise<T> {
    const url = this.buildUrl(args.path, args.query);
    const res = await this.fetchImpl(url, {
      method: args.method,
      headers: this.headers(),
      body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    let body: unknown;
    const text = await res.text();
    try {
      body = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const message =
        (body as { error?: string })?.error ??
        `HTTP ${res.status} ${res.statusText}`;
      throw new ApiError(res.status, body, message);
    }
    return body as T;
  }

  get<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>({ method: "GET", path, query });
  }
  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "POST", path, body });
  }
  patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "PATCH", path, body });
  }
  del<T = unknown>(path: string): Promise<T> {
    return this.request<T>({ method: "DELETE", path });
  }
}
