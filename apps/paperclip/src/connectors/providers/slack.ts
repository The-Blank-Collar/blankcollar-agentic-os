/**
 * slack — fetch recent messages from configured Slack channels via the
 * Nango proxy.
 *
 * Status: framework registered, fetcher SKELETON. The full Slack API
 * pagination + thread normalization lands in the Sprint 5.4.b follow-up
 * once the website's Nango Connect flow is wired.
 *
 * Config (when implemented):
 *   {
 *     "channels": ["C012345", "C0ABCDE"],
 *     "lookback_hours": 24,
 *     "include_threads": true
 *   }
 */

import type { ConnectorProvider } from "../types.js";

export const slackProvider: ConnectorProvider = {
  info: {
    key: "slack",
    label: "Slack",
    hint: "Pull recent channel messages into the company brain. (Wires up in Sprint 5.4.b.)",
    status: "needs_oauth",
    config_schema: {
      type: "object",
      properties: {
        channels: {
          type: "array",
          items: { type: "string" },
          description: "Slack channel ids (e.g. C012345). Empty = all accessible channels.",
        },
        lookback_hours: {
          type: "integer",
          minimum: 1,
          maximum: 168,
          default: 24,
        },
        include_threads: { type: "boolean", default: true },
      },
    },
  },

  validateConfig(config) {
    const channels = (config as { channels?: unknown }).channels;
    if (channels !== undefined && !Array.isArray(channels)) {
      return "config.channels must be an array of strings";
    }
    if (Array.isArray(channels)) {
      if (channels.length > 200) return "config.channels is capped at 200 entries";
      for (const c of channels) {
        if (typeof c !== "string") return "config.channels entries must be strings";
      }
    }
    const lh = (config as { lookback_hours?: unknown }).lookback_hours;
    if (lh !== undefined && (typeof lh !== "number" || lh < 1 || lh > 168)) {
      return "config.lookback_hours must be 1..168";
    }
    return null;
  },

  async sync({ connector }) {
    if (!connector.nango_connection_id) {
      throw new Error(
        "Slack connector requires a Nango connection id. Run the Connect flow first.",
      );
    }
    // Skeleton: the real fetcher will call Nango's proxy at
    //   GET /api/proxy/conversations.history (per channel)
    // followed by /conversations.replies for threads, paginate, and
    // emit one ProviderArtifact per message-or-thread. Until that
    // ships, raise a clear "not yet implemented" so the operator knows
    // the connector is registered but the fetcher is still cooking.
    throw new Error(
      "Slack fetcher not yet implemented (Sprint 5.4.b). Connector registered + Nango connection accepted; messages will start flowing once the fetcher lands.",
    );
  },
};
