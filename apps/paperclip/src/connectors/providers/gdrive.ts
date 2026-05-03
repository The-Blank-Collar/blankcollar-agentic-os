/**
 * gdrive — Google Drive / Docs file changes → ops.document.
 * Status: stub. Full fetcher lands in Sprint 5.4.c.
 */

import type { ConnectorProvider } from "../types.js";

export const gdriveProvider: ConnectorProvider = {
  info: {
    key: "gdrive",
    label: "Google Drive",
    hint: "Index Drive folders + Docs into the company brain. (Wires up in Sprint 5.4.c.)",
    status: "needs_oauth",
    config_schema: {
      type: "object",
      properties: {
        folder_ids: { type: "array", items: { type: "string" } },
        mime_types: {
          type: "array",
          items: { type: "string" },
          default: ["application/vnd.google-apps.document"],
        },
      },
    },
  },
  validateConfig(config) {
    const folders = (config as { folder_ids?: unknown }).folder_ids;
    if (folders !== undefined && !Array.isArray(folders)) {
      return "config.folder_ids must be an array of strings";
    }
    return null;
  },
  async sync({ connector }) {
    if (!connector.nango_connection_id) {
      throw new Error(
        "Google Drive connector requires a Nango connection id. Run the Connect flow first.",
      );
    }
    throw new Error(
      "Google Drive fetcher not yet implemented (Sprint 5.4.c).",
    );
  },
};
