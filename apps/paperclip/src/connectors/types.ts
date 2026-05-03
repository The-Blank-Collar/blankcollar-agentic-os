/**
 * Connector framework — types shared by every provider.
 *
 * A "connector" is one configured source that yields many documents over
 * time (Slack channel → many messages, GDrive folder → many files, …).
 * Distinct from `ops.upstream_source` (Phase 2.5), which holds ONE sliding
 * document per URL.
 *
 * Each provider is a tiny module that implements `ConnectorProvider`. The
 * registry in `./registry.ts` maps provider keys → provider modules; the
 * sync runner in `./sync.ts` walks every due connector + dispatches to the
 * right provider.
 *
 * Backward compat: every new field is additive on `ops.connector` /
 * `ops.connector_artifact`. The framework never reads / writes
 * `ops.upstream_source` (that primitive stays exactly as-is).
 *
 * LLM-agnostic: providers don't make LLM calls themselves — they emit
 * normalized `ProviderArtifact[]` that the runner turns into ops.document
 * rows via the existing chunker. Future Sprint 5.3 (SOP→Skill) can run
 * over those documents the same way it does for any other.
 */

import type pg from "pg";

export type ProviderKey =
  | "manual_paste"
  | "url_poll"
  | "slack"
  | "gdrive"
  | "zoom"
  | "hubspot"
  | "notion";

export type ProviderStatus = "ready" | "needs_oauth" | "stub";

export type ProviderInfo = {
  key: ProviderKey;
  label: string;
  hint: string;
  /**
   * - 'ready'         — works without OAuth (manual_paste, url_poll).
   * - 'needs_oauth'   — requires `nango_connection_id`. Provider works
   *                     once a Nango Connect flow has produced the id.
   * - 'stub'          — registered for the picker so users see what's
   *                     coming, but `sync()` raises a clear error until
   *                     the follow-up sprint lands the fetcher.
   */
  status: ProviderStatus;
  /** Schema hint for the operator-facing config form. */
  config_schema: Record<string, unknown>;
};

export type ConnectorRow = {
  id: string;
  org_id: string;
  provider: ProviderKey;
  name: string;
  scope: "personal" | "company" | "shared";
  nango_connection_id: string | null;
  config: Record<string, unknown>;
  refresh_interval_seconds: number;
  last_synced_at: string | null;
  last_status: string | null;
  last_error: string | null;
  consecutive_failures: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * One piece of content the provider has decided is "ingestable" right
 * now. The runner upserts these into `ops.connector_artifact` keyed by
 * `external_id` and creates / replaces the linked `ops.document`.
 */
export type ProviderArtifact = {
  /** Stable identifier inside the provider (Slack message ts, GDrive id…). */
  external_id: string;
  /** Operator-facing title for the resulting document. */
  title: string;
  /** Markdown body to be chunked + indexed. */
  content_md: string;
  /** Optional metadata kept on the artifact row (channel, folder, author…). */
  metadata?: Record<string, unknown>;
  /** Optional explicit tags for the resulting document. */
  tags?: string[];
};

export type SyncContext = {
  /** Already inside a withOrgScope() transaction. */
  client: pg.PoolClient;
  org_id: string;
  connector: ConnectorRow;
};

export type SyncOutcome = {
  artifacts_added: number;
  artifacts_updated: number;
  artifacts_unchanged: number;
  warnings: string[];
};

export type ConnectorProvider = {
  info: ProviderInfo;
  /** Validate the operator-supplied config before save. Returns null on OK. */
  validateConfig(config: Record<string, unknown>): string | null;
  /**
   * Fetch the current set of artifacts the provider wants to surface. The
   * runner handles upserts + chunking; provider just shapes the data.
   *
   * Throws to fail the whole sync (consecutive_failures bumps). Use the
   * thrown message — it lands in `connector.last_error`.
   */
  sync(ctx: SyncContext): Promise<ProviderArtifact[]>;
};
