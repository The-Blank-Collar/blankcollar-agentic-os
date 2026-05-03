/**
 * manual_paste — simplest connector. Operator pastes content via
 * `POST /api/connectors/:id/paste`. Each paste lands as one
 * `ops.connector_artifact` keyed by a generated id.
 *
 * No OAuth, no network, no provider-specific config. Useful for:
 *   - Testing the connector framework end-to-end.
 *   - Operators who want to hand-feed an SOP without learning the doc
 *     ingestion CLI.
 *   - Demo / OSS path: works with zero external services.
 *
 * The route handler in `routes/connectors.ts` constructs a
 * ProviderArtifact from the paste payload + calls the runner directly,
 * so this provider's `sync()` method is a no-op (returns []).
 */

import type { ConnectorProvider } from "../types.js";

export const manualPasteProvider: ConnectorProvider = {
  info: {
    key: "manual_paste",
    label: "Manual paste",
    hint: "Paste markdown content yourself. No OAuth, ideal for ad-hoc SOPs.",
    status: "ready",
    config_schema: { type: "object", properties: {} },
  },
  validateConfig() {
    return null;
  },
  async sync() {
    // Manual paste doesn't pull on a schedule — the operator drives ingest
    // via POST /api/connectors/:id/paste, which constructs the artifact
    // directly. The scheduler tick still touches the connector to bump
    // last_synced_at, but the artifact set returned is always empty.
    return [];
  },
};
