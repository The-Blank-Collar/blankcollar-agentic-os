/**
 * Server-side URL fetcher for document ingestion.
 *
 * Used by:
 *   - the scheduler's upstream-source pull tick
 *   - (future) `POST /api/documents/from-url` for client-driven fetches
 *
 * Light HTML→text only. No headless browser, no JS evaluation. Sites
 * that require headless rendering (heavy SPA, paywalled) return thin
 * output → callers should treat empty/short results as a soft fail.
 *
 * The function is stateless and accepts an injectable `fetchImpl` so
 * tests can mock the network without touching `globalThis.fetch`.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = "blankcollar-paperclip/0.1 (+upstream-pull)";

export type FetchExternalResult = {
  text: string;
  mime: string;
  /** Best-effort title extraction (HTML <title>, falls back to URL). */
  title: string;
  /** Final URL after redirects, if any. */
  final_url: string;
  /** HTTP status from the final response. */
  status: number;
};

export type FetchExternalOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class FetchExternalError extends Error {
  status: number;
  url: string;
  constructor(url: string, status: number, message: string) {
    super(message);
    this.url = url;
    this.status = status;
  }
}

/**
 * Strip HTML to plain text. Removes <script>/<style>/<nav>/<header>/
 * <footer> wholesale, replaces block-level closing tags with paragraph
 * breaks, decodes the common entities, and collapses runs of whitespace.
 *
 * Exported for unit tests.
 */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  s = s.replace(/<header[\s\S]*?<\/header>/gi, "");
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  s = s.replace(/<\/(p|div|article|section|h[1-6]|li|tr|br)>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n[ \t]+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Best-effort `<title>` scrape; falls back to the URL on miss. */
export function extractHtmlTitle(html: string, fallback: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m?.[1]) return fallback;
  return m[1].trim().replace(/\s+/g, " ").slice(0, 500);
}

/**
 * Fetch a URL and reduce it to ingest-ready { text, mime, title }.
 * Throws FetchExternalError on transport failure / non-2xx.
 *
 * Empty / whitespace-only output is returned as-is (text=""); callers
 * decide whether to ingest or to record a "no extractable text" failure.
 */
export async function fetchExternalUrl(
  url: string,
  opts: FetchExternalOptions = {},
): Promise<FetchExternalResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html, text/plain, application/json, */*" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new FetchExternalError(url, 0, `network: ${(err as Error).message}`);
  }

  if (!res.ok) {
    throw new FetchExternalError(url, res.status, `HTTP ${res.status} ${res.statusText}`);
  }

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const body = await res.text();
  const finalUrl = res.url || url;

  let text: string;
  let mime: string;
  let title = url;

  if (ct.includes("text/html")) {
    title = extractHtmlTitle(body, url);
    text = htmlToText(body);
    mime = "text/html";
  } else if (ct.includes("markdown")) {
    text = body.trim();
    mime = "text/markdown";
  } else if (ct.includes("application/json")) {
    text = body.trim();
    mime = "application/json";
  } else if (ct.includes("text/plain")) {
    text = body.trim();
    mime = "text/plain";
  } else {
    // Best-effort: treat as text. Binary content (PDF, images) will
    // produce garbage — caller should reject empty / short output.
    text = body.trim();
    mime = ct || "text/plain";
  }

  return { text, mime, title, final_url: finalUrl, status: res.status };
}
