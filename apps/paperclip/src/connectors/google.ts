/**
 * Google Workspace convenience connectors.
 *
 * All Google calls go through self-hosted Nango (see docs/NANGO.md). Each
 * function below is a thin typed wrapper that:
 *   1. Resolves the caller's connection_id (from the user's OAuth state).
 *   2. Calls Nango's proxy endpoint with the right Google API path.
 *   3. Normalises the response into a stable, vendor-agnostic shape.
 *
 * Mode-aware: in single-user mode the connection_id is the lone user's;
 * in multi-user mode the caller passes a connection_id explicitly (or the
 * skill manifest specifies whose) so company calendars / shared drives can
 * be addressed.
 *
 * These are NOT skills themselves — they're the building blocks the
 * skill-side runtime (in OpenClaw) calls. The skill manifests live in
 * packages/skills/manifests/shared/google.*.yaml.
 */

import { config } from "../config.js";

const NANGO_URL = process.env.NANGO_URL ?? "http://nango:3003";
const NANGO_SECRET = process.env.NANGO_SECRET_KEY ?? "";
const GOOGLE_PROVIDER = process.env.NANGO_GOOGLE_PROVIDER_KEY ?? "google";

type NangoProxyResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function nangoProxy<T>(args: {
  connectionId: string;
  endpoint: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  params?: Record<string, unknown>;
  body?: unknown;
}): Promise<NangoProxyResult<T>> {
  if (!NANGO_SECRET) {
    return { ok: false, error: "NANGO_SECRET_KEY unset — Google connectors disabled" };
  }
  const url = new URL(`/proxy${args.endpoint}`, NANGO_URL);
  if (args.params) {
    for (const [k, v] of Object.entries(args.params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  try {
    const res = await fetch(url, {
      method: args.method ?? "GET",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${NANGO_SECRET}`,
        "Connection-Id": args.connectionId,
        "Provider-Config-Key": GOOGLE_PROVIDER,
      },
      body: args.body ? JSON.stringify(args.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `nango ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------- Gmail --------------------------------------------------------

export type GmailThreadSummary = {
  id: string;
  thread_id: string;
  from: string;
  subject: string;
  snippet: string;
  received_at: string;
};

export async function gmailSearch(args: {
  connectionId: string;
  query: string;
  maxResults?: number;
}): Promise<NangoProxyResult<{ threads: GmailThreadSummary[] }>> {
  const list = await nangoProxy<{ messages?: { id: string; threadId: string }[] }>({
    connectionId: args.connectionId,
    endpoint: "/gmail/v1/users/me/messages",
    params: { q: args.query, maxResults: args.maxResults ?? 10 },
  });
  if (!list.ok) return list;
  const ids = (list.data.messages ?? []).slice(0, args.maxResults ?? 10);
  const threads: GmailThreadSummary[] = [];
  for (const m of ids) {
    const detail = await nangoProxy<{
      id: string;
      threadId: string;
      snippet: string;
      payload: { headers: { name: string; value: string }[] };
      internalDate: string;
    }>({
      connectionId: args.connectionId,
      endpoint: `/gmail/v1/users/me/messages/${m.id}`,
      params: { format: "metadata", metadataHeaders: "From" },
    });
    if (!detail.ok) continue;
    const headers = detail.data.payload?.headers ?? [];
    const fromHdr = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
    const subjectHdr = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
    threads.push({
      id: detail.data.id,
      thread_id: detail.data.threadId,
      from: fromHdr,
      subject: subjectHdr,
      snippet: detail.data.snippet,
      received_at: new Date(Number(detail.data.internalDate)).toISOString(),
    });
  }
  return { ok: true, data: { threads } };
}

// ---------- Calendar -----------------------------------------------------

export type CalendarEventInput = {
  connectionId: string;
  calendarId?: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  attendees?: string[];
};

export async function calendarCreateEvent(
  args: CalendarEventInput,
): Promise<NangoProxyResult<{ id: string; htmlLink: string }>> {
  const calId = args.calendarId ?? "primary";
  return nangoProxy<{ id: string; htmlLink: string }>({
    connectionId: args.connectionId,
    endpoint: `/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
    method: "POST",
    body: {
      summary: args.summary,
      description: args.description,
      start: { dateTime: args.start },
      end: { dateTime: args.end },
      attendees: (args.attendees ?? []).map((email) => ({ email })),
    },
  });
}

// ---------- Drive --------------------------------------------------------

export type DriveFileSummary = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
};

export async function driveSearch(args: {
  connectionId: string;
  query: string;
  maxResults?: number;
}): Promise<NangoProxyResult<{ files: DriveFileSummary[] }>> {
  return nangoProxy<{ files: DriveFileSummary[] }>({
    connectionId: args.connectionId,
    endpoint: "/drive/v3/files",
    params: {
      q: args.query,
      pageSize: args.maxResults ?? 20,
      fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    },
  });
}

// ---------- Docs ---------------------------------------------------------

export async function docsAppend(args: {
  connectionId: string;
  documentId: string;
  markdown: string;
}): Promise<NangoProxyResult<{ documentId: string }>> {
  // Append at end of doc. We translate markdown to plain text for v0;
  // formatted insertion uses richer batchUpdate requests later.
  const text = args.markdown.endsWith("\n") ? args.markdown : args.markdown + "\n";
  const res = await nangoProxy<{ replies: unknown[] }>({
    connectionId: args.connectionId,
    endpoint: `/docs/v1/documents/${args.documentId}:batchUpdate`,
    method: "POST",
    body: {
      requests: [
        {
          insertText: {
            endOfSegmentLocation: {},
            text,
          },
        },
      ],
    },
  });
  if (!res.ok) return res;
  return { ok: true, data: { documentId: args.documentId } };
}

// ---------- Sheets -------------------------------------------------------

export async function sheetsAppendRow(args: {
  connectionId: string;
  spreadsheetId: string;
  range?: string;
  values: string[];
}): Promise<NangoProxyResult<{ updatedRange: string }>> {
  const range = args.range ?? "Sheet1!A:Z";
  const res = await nangoProxy<{ updates: { updatedRange: string } }>({
    connectionId: args.connectionId,
    endpoint: `/sheets/v4/spreadsheets/${args.spreadsheetId}/values/${encodeURIComponent(range)}:append`,
    method: "POST",
    params: { valueInputOption: "USER_ENTERED" },
    body: { values: [args.values] },
  });
  if (!res.ok) return res;
  return { ok: true, data: { updatedRange: res.data.updates.updatedRange } };
}

// ---------- Health -------------------------------------------------------

/**
 * Probe Nango + the Google connector. Used by /api/health to surface
 * "Workspace ready" / "OAuth missing" without a full request lifecycle.
 */
export async function googleConnectorsReady(): Promise<{ ok: boolean; reason?: string }> {
  if (!NANGO_SECRET) return { ok: false, reason: "NANGO_SECRET_KEY unset" };
  // Check that the provider config exists in Nango (fast, cheap).
  try {
    const res = await fetch(new URL("/config", NANGO_URL), {
      headers: { authorization: `Bearer ${NANGO_SECRET}` },
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok ? { ok: true } : { ok: false, reason: `nango ${res.status}` };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

void config; // currently unused; reserved for future per-org provider key overrides
