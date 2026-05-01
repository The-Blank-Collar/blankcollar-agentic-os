/** pg pool + tiny query helpers. */

import pg from "pg";

import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` inside a transaction with the session GUC `app.org_id` bound to
 * the caller's scope. Postgres RLS policies on every org-scoped table
 * enforce `org_id = current_setting('app.org_id')` while inside this
 * transaction. `SET LOCAL` ensures the binding is dropped automatically on
 * COMMIT/ROLLBACK so pooled connections don't leak scope across requests.
 *
 * Routes opt in to RLS-enforced scope by running their queries through this
 * helper instead of `tx()` directly. Eventually all routes migrate; the
 * RLS policies' permissive default (unset = ALL) flips to NONE.
 */
export async function withOrgScope<T>(
  orgId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // `set_config(name, value, is_local=true)` is the parameterised form
    // of SET LOCAL — safe against injection for the value, plus survives
    // the COMMIT boundary cleanly.
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Privileged scope for cross-org system tasks: the worker claiming runs,
 * the scheduler scanning all orgs for due routines, the bootstrap
 * sweeping every org. Sets `app.system_scope = 'true'` so the
 * `app_system_scope` policy fires and bypasses the normal per-org check.
 *
 * Use this sparingly — anything that touches user-facing requests must go
 * through `withOrgScope()` instead. System scope is for the engine's own
 * heartbeat, not for handler logic.
 */
export async function withSystemScope<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.system_scope', 'true', true)");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function close(): Promise<void> {
  await pool.end();
}
