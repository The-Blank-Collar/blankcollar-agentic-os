import { describe, expect, it } from "vitest";

import { ApiError, Client } from "../src/api.js";

describe("Client.buildUrl", () => {
  it("composes path + querystring against BC_API_URL", () => {
    const c = new Client({ baseUrl: "http://localhost:3000", orgSlug: "x" });
    const url = c.buildUrl("/api/goals", { status: "active", limit: 10 });
    expect(url.toString()).toBe("http://localhost:3000/api/goals?status=active&limit=10");
  });

  it("strips trailing slashes from baseUrl", () => {
    const c = new Client({ baseUrl: "http://localhost:3000/", orgSlug: "x" });
    expect(c.buildUrl("/api/health").toString()).toBe("http://localhost:3000/api/health");
  });

  it("accepts a path without leading slash", () => {
    const c = new Client({ baseUrl: "http://localhost:3000", orgSlug: "x" });
    expect(c.buildUrl("api/health").toString()).toBe("http://localhost:3000/api/health");
  });

  it("skips undefined query values", () => {
    const c = new Client({ baseUrl: "http://localhost:3000", orgSlug: "x" });
    const url = c.buildUrl("/api/goals", { status: "active", kind: undefined });
    expect(url.searchParams.has("kind")).toBe(false);
    expect(url.searchParams.get("status")).toBe("active");
  });
});

describe("Client.request", () => {
  function fakeFetch(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
    return ((url: string | URL | Request, init?: RequestInit) => {
      const req = new Request(url instanceof URL ? url.toString() : url, init);
      return Promise.resolve(handler(req));
    }) as typeof fetch;
  }

  it("returns parsed JSON on 200", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const c = new Client({ fetchImpl, orgSlug: "x" });
    const out = await c.get<{ ok: boolean }>("/api/health");
    expect(out.ok).toBe(true);
  });

  it("sends X-BC-Org-Slug header", async () => {
    let captured = "";
    const fetchImpl = fakeFetch((req) => {
      captured = req.headers.get("x-bc-org-slug") ?? "";
      return new Response("{}", { status: 200 });
    });
    const c = new Client({ fetchImpl, orgSlug: "blankcollar-personal" });
    await c.get("/api/health");
    expect(captured).toBe("blankcollar-personal");
  });

  it("includes Authorization when token is set", async () => {
    let auth = "";
    const fetchImpl = fakeFetch((req) => {
      auth = req.headers.get("authorization") ?? "";
      return new Response("{}", { status: 200 });
    });
    const c = new Client({ fetchImpl, orgSlug: "x", token: "abc" });
    await c.get("/api/health");
    expect(auth).toBe("Bearer abc");
  });

  it("returns undefined on 204", async () => {
    const fetchImpl = fakeFetch(() => new Response(null, { status: 204 }));
    const c = new Client({ fetchImpl, orgSlug: "x" });
    const out = await c.del("/api/key-results/x");
    expect(out).toBeUndefined();
  });

  it("throws ApiError with parsed body on 4xx/5xx", async () => {
    const fetchImpl = fakeFetch(
      () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    const c = new Client({ fetchImpl, orgSlug: "x" });
    await expect(c.get("/api/goals/missing")).rejects.toBeInstanceOf(ApiError);
    try {
      await c.get("/api/goals/missing");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.status).toBe(404);
      expect(e.message).toBe("not_found");
    }
  });

  it("falls back to status-text message when body has no error field", async () => {
    const fetchImpl = fakeFetch(() => new Response("oops", { status: 500, statusText: "Server Error" }));
    const c = new Client({ fetchImpl, orgSlug: "x" });
    try {
      await c.get("/api/health");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toContain("500");
    }
  });
});
