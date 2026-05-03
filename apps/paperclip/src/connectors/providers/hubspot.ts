/**
 * hubspot — CRM contacts/companies/notes → ops.document.
 * Status: stub. Fetcher lands in Sprint 5.4.e.
 */

import type { ConnectorProvider } from "../types.js";

export const hubspotProvider: ConnectorProvider = {
  info: {
    key: "hubspot",
    label: "HubSpot",
    hint: "Index CRM notes, calls, and emails. (Wires up in Sprint 5.4.e.)",
    status: "needs_oauth",
    config_schema: {
      type: "object",
      properties: {
        object_types: {
          type: "array",
          items: { type: "string", enum: ["notes", "calls", "emails", "meetings"] },
          default: ["notes"],
        },
      },
    },
  },
  validateConfig() {
    return null;
  },
  async sync({ connector }) {
    if (!connector.nango_connection_id) {
      throw new Error(
        "HubSpot connector requires a Nango connection id. Run the Connect flow first.",
      );
    }
    throw new Error(
      "HubSpot fetcher not yet implemented (Sprint 5.4.e).",
    );
  },
};
