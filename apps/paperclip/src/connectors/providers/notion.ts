/**
 * notion — Notion wiki pages → ops.document.
 * Status: stub. Fetcher lands in Sprint 5.4.f.
 */

import type { ConnectorProvider } from "../types.js";

export const notionProvider: ConnectorProvider = {
  info: {
    key: "notion",
    label: "Notion",
    hint: "Index wiki pages on a schedule. (Wires up in Sprint 5.4.f.)",
    status: "needs_oauth",
    config_schema: {
      type: "object",
      properties: {
        database_ids: { type: "array", items: { type: "string" } },
      },
    },
  },
  validateConfig() {
    return null;
  },
  async sync({ connector }) {
    if (!connector.nango_connection_id) {
      throw new Error(
        "Notion connector requires a Nango connection id. Run the Connect flow first.",
      );
    }
    throw new Error(
      "Notion fetcher not yet implemented (Sprint 5.4.f).",
    );
  },
};
