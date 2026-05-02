import { describe, expect, it, vi } from "vitest";

import {
  extractHtmlTitle,
  fetchExternalUrl,
  FetchExternalError,
  htmlToText,
} from "../src/documents/fetch.js";

function fakeResponse(
  body: string,
  opts: { status?: number; contentType?: string; finalUrl?: string } = {},
): Response {
  const status = opts.status ?? 200;
  const headers = new Headers({
    "content-type": opts.contentType ?? "text/html; charset=utf-8",
  });
  // Response.url isn't writable; emulate via subclass-ish object.
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers,
    text: async () => body,
    url: opts.finalUrl ?? "",
  } as unknown as Response;
}

describe("htmlToText", () => {
  it("strips script + style + nav blocks wholesale", () => {
    const out = htmlToText(
      `<nav>top nav</nav><script>alert(1)</script><style>x{}</style><p>visible</p><footer>bottom</footer>`,
    );
    expect(out).toContain("visible");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("top nav");
    expect(out).not.toContain("bottom");
    expect(out).not.toContain("x{}");
  });

  it("decodes common entities", () => {
    expect(htmlToText("<p>5 &lt; 10 &amp; 6 &gt; 3 &quot;OK&quot; &#39;done&#39;</p>"))
      .toBe(`5 < 10 & 6 > 3 "OK" 'done'`);
  });

  it("turns block closes into paragraph breaks", () => {
    const out = htmlToText("<h1>Title</h1><p>Para one.</p><p>Para two.</p>");
    expect(out.split("\n\n").length).toBeGreaterThanOrEqual(2);
  });

  it("collapses runs of whitespace", () => {
    expect(htmlToText("<p>hello   \t\t world</p>")).toBe("hello world");
  });
});

describe("extractHtmlTitle", () => {
  it("returns the inner text of <title>", () => {
    expect(extractHtmlTitle("<html><title>My Page</title></html>", "fb")).toBe("My Page");
  });
  it("falls back when missing", () => {
    expect(extractHtmlTitle("<html>no title</html>", "fb")).toBe("fb");
  });
  it("trims + collapses whitespace inside title", () => {
    expect(extractHtmlTitle("<title>\n  hello\t world  \n</title>", "fb")).toBe("hello world");
  });
});

describe("fetchExternalUrl", () => {
  it("extracts text + title from an HTML response", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        fakeResponse(
          `<html><head><title>Demo Page</title></head><body><p>Hello world.</p></body></html>`,
          { contentType: "text/html; charset=utf-8", finalUrl: "https://example.com/" },
        ),
      );
    const r = await fetchExternalUrl("https://example.com/", { fetchImpl });
    expect(r.title).toBe("Demo Page");
    expect(r.mime).toBe("text/html");
    expect(r.text).toContain("Hello world");
    expect(r.final_url).toBe("https://example.com/");
    expect(r.status).toBe(200);
  });

  it("returns markdown bodies untouched", async () => {
    const md = "# Heading\n\nA paragraph.";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(fakeResponse(md, { contentType: "text/markdown" }));
    const r = await fetchExternalUrl("https://example.com/x.md", { fetchImpl });
    expect(r.mime).toBe("text/markdown");
    expect(r.text).toBe(md);
  });

  it("returns plain text bodies untouched", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(fakeResponse("just a string", { contentType: "text/plain" }));
    const r = await fetchExternalUrl("https://example.com/", { fetchImpl });
    expect(r.mime).toBe("text/plain");
    expect(r.text).toBe("just a string");
  });

  it("throws FetchExternalError on non-2xx", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(fakeResponse("nope", { status: 404, contentType: "text/html" }));
    await expect(fetchExternalUrl("https://example.com/", { fetchImpl })).rejects.toMatchObject({
      constructor: FetchExternalError,
      status: 404,
    });
  });

  it("wraps network errors in FetchExternalError with status=0", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("ENOTFOUND"));
    await expect(fetchExternalUrl("https://example.invalid/", { fetchImpl })).rejects.toMatchObject({
      constructor: FetchExternalError,
      status: 0,
      message: expect.stringContaining("network"),
    });
  });

  it("sends the user-agent + accept headers", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(fakeResponse("<p>x</p>", { contentType: "text/html" }));
    await fetchExternalUrl("https://example.com/", { fetchImpl });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["user-agent"]).toMatch(/blankcollar/);
    expect(headers.accept).toContain("text/html");
  });
});
