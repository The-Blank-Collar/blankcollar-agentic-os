/**
 * zoom — meeting transcripts → ops.document.
 * Status: stub. Webhook-driven fetcher lands in Sprint 5.4.d.
 */

import type { ConnectorProvider } from "../types.js";

export const zoomProvider: ConnectorProvider = {
  info: {
    key: "zoom",
    label: "Zoom",
    hint: "Index meeting transcripts as they finish. (Wires up in Sprint 5.4.d.)",
    status: "needs_oauth",
    config_schema: {
      type: "object",
      properties: {
        only_users: { type: "array", items: { type: "string" } },
      },
    },
  },
  validateConfig() {
    return null;
  },
  async sync({ connector }) {
    if (!connector.nango_connection_id) {
      throw new Error(
        "Zoom connector requires a Nango connection id. Run the Connect flow first.",
      );
    }
    throw new Error(
      "Zoom fetcher not yet implemented (Sprint 5.4.d).",
    );
  },
};
