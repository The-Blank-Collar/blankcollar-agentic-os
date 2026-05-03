/**
 * Connector sync runner.
 *
 *   syncOneConnector()  — full sync pass for one connector. Loads the
 *                          row, dispatches to the provider's sync(),
 *                          upserts artifacts + their documents, updates
 *                          last_status / last_error / consecutive_failures,
 *                          and writes an audit row.
 *   ingestPaste()        — manual_paste fast path. The route handler
 *                          builds a ProviderArtifact from the paste body
 *                          and calls this directly so the operator gets
 *                          immediate feedback.
 *
 * Both paths funnel through `materialiseArtifact()` which:
 *   1. Computes sha256 of content_md.
 *   2. If an artifact already exists with the same hash → no-op (touch
 *      last_seen_at), increments `unchanged`.
 *   3. Otherwise → atomic doc replace:
 *        - delete the old `document_id` (if any, chunks cascade)
 *        - insert a new ops.document
 *        - chunk + insert ops.document_chunk rows
 *        - upsert the artifact pointing at the new doc
 *
 * Failures are caught + recorded — never throw out of syncOneConnector
 * (callers expect a SyncOutcome or an error object).
 */

import { createHash } from "node:crypto";

import type pg from "pg";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { chunkText } from "../documents/chunker.js";
import { resolveCallerScope } from "../scope.js";
import type { Scope } from "../schemas.js";
import { getProvider } from "./registry.js";
import type {
  ConnectorRow,
  ProviderArtifact,
  SyncOutcome,
} from "./types.js";

const FAILURE_DISABLE_THRESHOLD = 5;

const CONNECTOR_COLUMNS = `
  id, org_id, provider, name, scope, nango_connection_id, config,
  refresh_interval_seconds, last_synced_at, last_status, last_error,
  consecutive_failures, enabled, created_at, updated_at
`;

export type SyncFinalState = SyncOutcome & {
  status: "ok" | "no_op" | "failed";
  error: string | null;
};

export async function syncOneConnector(
  orgId: string,
  connectorId: string,
  scope: Scope,
): Promise<SyncFinalState> {
  return withOrgScope(orgId, async (client) => {
    const { rows } = await client.query<ConnectorRow>(
      `SELECT ${CONNECTOR_COLUMNS} FROM ops.connector
        WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [connectorId, orgId],
    );
    if (rows.length === 0) {
      return finalState({ artifacts_added: 0, artifacts_updated: 0, artifacts_unchanged: 0, warnings: [] }, "failed", "connector not found");
    }
    const connector = rows[0]!;
    const provider = getProvider(connector.provider);
    if (!provider) {
      return touch(client, connector, scope, "failed", `unknown provider: ${connector.provider}`);
    }

    let artifacts: ProviderArtifact[];
    try {
      artifacts = await provider.sync({ client, org_id: orgId, connector });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return touch(client, connector, scope, "failed", msg);
    }

    const outcome: SyncOutcome = {
      artifacts_added: 0,
      artifacts_updated: 0,
      artifacts_unchanged: 0,
      warnings: [],
    };
    for (const artifact of artifacts) {
      try {
        const action = await materialiseArtifact(client, connector, artifact);
        if (action === "added") outcome.artifacts_added++;
        else if (action === "updated") outcome.artifacts_updated++;
        else outcome.artifacts_unchanged++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outcome.warnings.push(`artifact ${artifact.external_id}: ${msg}`);
      }
    }

    const status =
      artifacts.length === 0
        ? ("no_op" as const)
        : outcome.warnings.length === artifacts.length
          ? ("failed" as const)
          : ("ok" as const);
    const error =
      status === "failed"
        ? outcome.warnings.slice(0, 3).join("; ")
        : null;

    await client.query(
      `UPDATE ops.connector
          SET last_synced_at = now(),
              last_status = $2,
              last_error = $3,
              consecutive_failures = CASE
                WHEN $2 = 'failed' THEN consecutive_failures + 1
                ELSE 0
              END,
              enabled = CASE
                WHEN $2 = 'failed' AND consecutive_failures + 1 >= $4 THEN false
                ELSE enabled
              END,
              updated_at = now()
        WHERE id = $1`,
      [connector.id, status, error, FAILURE_DISABLE_THRESHOLD],
    );

    await audit(
      {
        scope,
        action: "connector.sync",
        target_type: "connector",
        target_id: connector.id,
        metadata: {
          provider: connector.provider,
          status,
          ...outcome,
        },
      },
      client,
    );

    return { ...outcome, status, error };
  });
}

/**
 * Manual paste fast path. Skips the provider.sync() call (manual_paste's
 * sync is intentionally a no-op) — instead, the route hands us a single
 * ProviderArtifact built from the paste payload and we materialize it.
 */
export async function ingestPaste(
  orgId: string,
  connectorId: string,
  artifact: ProviderArtifact,
  scope: Scope,
): Promise<{ document_id: string; action: "added" | "updated" | "unchanged" }> {
  return withOrgScope(orgId, async (client) => {
    const { rows } = await client.query<ConnectorRow>(
      `SELECT ${CONNECTOR_COLUMNS} FROM ops.connector
        WHERE id = $1 AND org_id = $2 AND provider = 'manual_paste' FOR UPDATE`,
      [connectorId, orgId],
    );
    if (rows.length === 0) {
      throw new Error("connector not found or wrong provider (must be manual_paste)");
    }
    const connector = rows[0]!;
    const action = await materialiseArtifact(client, connector, artifact);
    const documentId = await loadArtifactDocumentId(client, connector.id, artifact.external_id);

    await client.query(
      `UPDATE ops.connector
          SET last_synced_at = now(),
              last_status = 'ok',
              last_error = NULL,
              consecutive_failures = 0,
              updated_at = now()
        WHERE id = $1`,
      [connector.id],
    );
    await audit(
      {
        scope,
        action: "connector.paste",
        target_type: "connector",
        target_id: connector.id,
        metadata: { external_id: artifact.external_id, document_id: documentId, action },
      },
      client,
    );
    return { document_id: documentId, action };
  });
}

// -- internals -------------------------------------------------------------

async function materialiseArtifact(
  client: pg.PoolClient,
  connector: ConnectorRow,
  artifact: ProviderArtifact,
): Promise<"added" | "updated" | "unchanged"> {
  const hash = sha256(artifact.content_md);

  // Look up existing artifact for (connector_id, external_id).
  const { rows: existing } = await client.query<{
    id: string;
    document_id: string | null;
    content_hash: string | null;
  }>(
    `SELECT id, document_id, content_hash
       FROM ops.connector_artifact
      WHERE connector_id = $1 AND external_id = $2 FOR UPDATE`,
    [connector.id, artifact.external_id],
  );

  if (existing.length > 0 && existing[0]!.content_hash === hash) {
    // No change — touch last_seen_at and return.
    await client.query(
      `UPDATE ops.connector_artifact
          SET last_seen_at = now(),
              metadata = COALESCE($2::jsonb, metadata),
              updated_at = now()
        WHERE id = $1`,
      [existing[0]!.id, artifact.metadata ? JSON.stringify(artifact.metadata) : null],
    );
    return "unchanged";
  }

  // Drop the old document if there was one (chunks cascade).
  if (existing.length > 0 && existing[0]!.document_id) {
    await client.query("DELETE FROM ops.document WHERE id = $1", [existing[0]!.document_id]);
  }

  // Chunk first so we can insert chunk_count into the document row.
  const chunks = chunkText(artifact.content_md);

  // ops.document has UNIQUE (org_id, content_hash) — same content in same
  // org is the same logical doc. ON CONFLICT … RETURNING handles the case
  // where two connectors / artifacts produced identical content.
  const { rows: docRows } = await client.query<{ id: string }>(
    `INSERT INTO ops.document
       (org_id, scope, title, source_filename, mime_type, content_hash, tags,
        char_count, chunk_count)
     VALUES ($1, $2::ops.skill_scope, $3, $4, 'text/markdown', $5, $6::text[],
             $7, $8)
     ON CONFLICT (org_id, content_hash) DO UPDATE
       SET title = EXCLUDED.title,
           updated_at = now()
     RETURNING id`,
    [
      connector.org_id,
      connector.scope,
      artifact.title.slice(0, 500) || "untitled",
      `connector:${connector.provider}:${artifact.external_id}`.slice(0, 255),
      hash,
      artifact.tags ?? [],
      artifact.content_md.length,
      chunks.length,
    ],
  );
  const documentId = docRows[0]!.id;

  // Replace chunks for this document.
  await client.query("DELETE FROM ops.document_chunk WHERE document_id = $1", [documentId]);
  for (const c of chunks) {
    await client.query(
      `INSERT INTO ops.document_chunk
         (document_id, org_id, chunk_index, total_chunks, text, char_start, char_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [documentId, connector.org_id, c.index, c.total, c.text, c.char_start, c.char_end],
    );
  }

  if (existing.length === 0) {
    await client.query(
      `INSERT INTO ops.connector_artifact
         (org_id, connector_id, external_id, document_id, content_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        connector.org_id,
        connector.id,
        artifact.external_id,
        documentId,
        hash,
        JSON.stringify(artifact.metadata ?? {}),
      ],
    );
    return "added";
  }
  await client.query(
    `UPDATE ops.connector_artifact
        SET document_id = $2,
            content_hash = $3,
            metadata = COALESCE($4::jsonb, metadata),
            last_seen_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [existing[0]!.id, documentId, hash, artifact.metadata ? JSON.stringify(artifact.metadata) : null],
  );
  return "updated";
}

async function loadArtifactDocumentId(
  client: pg.PoolClient,
  connectorId: string,
  externalId: string,
): Promise<string> {
  const { rows } = await client.query<{ document_id: string | null }>(
    `SELECT document_id FROM ops.connector_artifact
      WHERE connector_id = $1 AND external_id = $2`,
    [connectorId, externalId],
  );
  if (rows.length === 0 || !rows[0]!.document_id) {
    throw new Error("artifact materialised but document_id missing");
  }
  return rows[0]!.document_id;
}

async function touch(
  client: pg.PoolClient,
  connector: ConnectorRow,
  scope: Scope,
  status: "failed" | "ok" | "no_op",
  error: string | null,
): Promise<SyncFinalState> {
  await client.query(
    `UPDATE ops.connector
        SET last_synced_at = now(),
            last_status = $2,
            last_error = $3,
            consecutive_failures = CASE
              WHEN $2 = 'failed' THEN consecutive_failures + 1
              ELSE 0
            END,
            enabled = CASE
              WHEN $2 = 'failed' AND consecutive_failures + 1 >= $4 THEN false
              ELSE enabled
            END,
            updated_at = now()
      WHERE id = $1`,
    [connector.id, status, error, FAILURE_DISABLE_THRESHOLD],
  );
  await audit(
    {
      scope,
      action: "connector.sync",
      target_type: "connector",
      target_id: connector.id,
      metadata: { provider: connector.provider, status, error },
    },
    client,
  );
  return finalState(
    { artifacts_added: 0, artifacts_updated: 0, artifacts_unchanged: 0, warnings: error ? [error] : [] },
    status,
    error,
  );
}

function finalState(o: SyncOutcome, status: "ok" | "no_op" | "failed", error: string | null): SyncFinalState {
  return { ...o, status, error };
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Resolve a stub scope for use inside the scheduler tick (no request).
 * Pulled out so the scheduler can reuse `syncOneConnector` without
 * needing a FastifyRequest.
 */
export async function systemSyncScope(orgId: string): Promise<Scope> {
  // Use the existing caller resolver; with no request it returns the
  // stub-org owner scope. The org_id we pass for filtering is enough.
  void orgId; // future: switch to org-specific scope when multi-org lands
  return resolveCallerScope();
}
