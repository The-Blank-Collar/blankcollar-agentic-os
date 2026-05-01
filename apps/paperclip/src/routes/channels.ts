/**
 * Channels API.
 *
 *   GET /api/channels    — connected providers (Slack, Email, WhatsApp,
 *                          Telegram, Google, etc.) + last-activity per
 *                          channel + counts of recent captures.
 *
 * Sources:
 *   - Nango (`/connections` endpoint) for OAuth-managed providers.
 *   - email-ingest captures for the `email` channel (separate stack).
 *   - audit_log for last activity per channel namespace.
 *
 * v0 returns a typed list the UI can render directly. When NANGO_SECRET_KEY
 * is unset, we still return the email channel (driven by email-ingest /
 * webhook) so single-user installs see something useful.
 */

import type { FastifyInstance } from "fastify";

import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";

type NangoConnection = {
  id: string;
  connection_id: string;
  provider_config_key: string;
  provider: string;
  created: string;
  last_fetched_at?: string;
};

type ChannelRow = {
  id: string;
  provider: string;
  display: string;
  connection_id: string | null;
  state: "connected" | "disconnected";
  last_activity_at: string | null;
  recent_capture_count: number;
};

const NANGO_URL = process.env.NANGO_URL ?? "http://nango:3003";
const NANGO_SECRET = () => process.env.NANGO_SECRET_KEY ?? "";

function displayName(provider: string): string {
  const map: Record<string, string> = {
    slack: "Slack",
    google: "Google Workspace",
    "google-mail": "Gmail",
    notion: "Notion",
    linear: "Linear",
    github: "GitHub",
    hubspot: "HubSpot",
    salesforce: "Salesforce",
    whatsapp: "WhatsApp",
    telegram: "Telegram",
    stripe: "Stripe",
  };
  return map[provider] ?? provider;
}

async function fetchNangoConnections(): Promise<NangoConnection[]> {
  const secret = NANGO_SECRET();
  if (!secret) return [];
  try {
    const res = await fetch(new URL("/connection", NANGO_URL), {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { connections?: NangoConnection[] };
    return body.connections ?? [];
  } catch {
    return [];
  }
}

export async function channelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/channels", async (req) => {
    const scope = await resolveCallerScope(req);

    // Nango-managed channels.
    const connections = await fetchNangoConnections();
    const seenProviders = new Set<string>();
    const out: ChannelRow[] = [];

    for (const c of connections) {
      const provider = c.provider_config_key || c.provider;
      seenProviders.add(provider);
      out.push({
        id: c.id,
        provider,
        display: displayName(provider),
        connection_id: c.connection_id,
        state: "connected",
        last_activity_at: c.last_fetched_at ?? c.created,
        recent_capture_count: 0,
      });
    }

    // Email is special-cased — driven by email-ingest, not Nango.
    if (!seenProviders.has("email") && !seenProviders.has("gmail")) {
      out.push({
        id: "channel-email",
        provider: "email",
        display: "Email",
        connection_id: null,
        state: process.env.IMAP_HOST ? "connected" : "disconnected",
        last_activity_at: null,
        recent_capture_count: 0,
      });
    }

    // Webhook channel — always present, driven by /api/webhooks/capture.
    if (!seenProviders.has("webhook")) {
      out.push({
        id: "channel-webhook",
        provider: "webhook",
        display: "Webhook intake",
        connection_id: null,
        state: process.env.INBOUND_CAPTURE_WEBHOOK_SECRET ? "connected" : "disconnected",
        last_activity_at: null,
        recent_capture_count: 0,
      });
    }

    // Recent capture counts per source — labels matched against provider.
    const { rows: captureCounts } = await withOrgScope(scope.org_id, (client) =>
      client.query<{ source: string; ct: string; last_at: string }>(
        `SELECT source::text AS source, count(*)::text AS ct, max(created_at) AS last_at
           FROM ops.capture
          WHERE org_id = $1
            AND created_at >= now() - interval '7 days'
          GROUP BY source`,
        [scope.org_id],
      ),
    );
    const captureMap: Record<string, { ct: number; last: string }> = {};
    for (const c of captureCounts) {
      captureMap[c.source] = { ct: Number(c.ct), last: c.last_at };
    }
    for (const ch of out) {
      // Match capture source to channel where it makes sense.
      // email captures → channel.email, webhook → channel.webhook,
      // others (Slack/WhatsApp etc.) don't yet have a capture path.
      const sourceMatch =
        ch.provider === "email"
          ? captureMap.email
          : ch.provider === "webhook"
            ? captureMap.webhook
            : undefined;
      if (sourceMatch) {
        ch.recent_capture_count = sourceMatch.ct;
        ch.last_activity_at = sourceMatch.last;
      }
    }

    return {
      channels: out.sort((a, b) => {
        if (a.state !== b.state) return a.state === "connected" ? -1 : 1;
        return a.display.localeCompare(b.display);
      }),
      generated_at: new Date().toISOString(),
    };
  });
}
