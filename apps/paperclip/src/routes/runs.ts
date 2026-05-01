import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";

type RunRow = {
  id: string;
  goal_id: string;
  agent_id: string | null;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export async function runRoutes(app: FastifyInstance): Promise<void> {
  // -- list (by goal) -----------------------------------------------------
  app.get<{ Querystring: { goal_id?: string } }>("/api/runs", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const where: string[] = ["g.org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (req.query.goal_id) {
      params.push(req.query.goal_id);
      where.push(`r.goal_id = $${params.length}`);
    }
    const sql = `
      SELECT r.id, r.goal_id, r.agent_id, r.status, r.input, r.output, r.error,
             r.started_at, r.finished_at, r.created_at
      FROM ops.run r
      JOIN ops.goal g ON g.id = r.goal_id
      WHERE ${where.join(" AND ")}
      ORDER BY r.created_at DESC
      LIMIT 100
    `;
    const rows = await withOrgScope(scope.org_id, async (client) => {
      const { rows: rs } = await client.query<RunRow>(sql, params);
      return rs;
    });
    if (req.query.goal_id) return rows;
    return reply.send(rows);
  });

  // -- get ----------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/runs/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const rows = await withOrgScope(scope.org_id, async (client) => {
      const { rows: rs } = await client.query<RunRow>(
        `SELECT r.*
         FROM ops.run r
         JOIN ops.goal g ON g.id = r.goal_id
         WHERE r.id = $1 AND g.org_id = $2`,
        [req.params.id, scope.org_id],
      );
      return rs;
    });
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });

  // -- stream (Server-Sent Events) ---------------------------------------
  // GET /api/runs/:id/stream — emits an event each time status / output /
  // error changes, plus a final 'done' event when the run reaches a
  // terminal state (succeeded | failed | cancelled). Clients connect with
  // Accept: text/event-stream and read line-delimited frames:
  //
  //   event: snapshot
  //   data: { "status": "running", "output": null, "error": null, "started_at": "...", "finished_at": null }
  //
  //   event: done
  //   data: { "status": "succeeded" }
  //
  // Implementation: poll ops.run every POLL_MS, emit only when something
  // changed. Cap at HARD_TIMEOUT_MS. RLS-bound via withOrgScope per poll.
  app.get<{ Params: { id: string } }>("/api/runs/:id/stream", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const POLL_MS = 750;
    const HARD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

    const initial = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<RunRow>(
        `SELECT r.*
         FROM ops.run r
         JOIN ops.goal g ON g.id = r.goal_id
         WHERE r.id = $1 AND g.org_id = $2`,
        [req.params.id, scope.org_id],
      );
      return rows[0];
    });
    if (!initial) return reply.code(404).send({ error: "not_found" });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no", // disable any reverse-proxy buffering
    });

    const send = (event: string, payload: unknown): void => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    // Always emit the current snapshot first so the client doesn't have
    // to do a prior GET /api/runs/:id.
    send("snapshot", projectRun(initial));
    if (TERMINAL.has(initial.status)) {
      send("done", { status: initial.status });
      reply.raw.end();
      return reply;
    }

    let last = projectRun(initial);
    const startedAt = Date.now();
    let closed = false;
    req.raw.on("close", () => {
      closed = true;
    });

    while (!closed && Date.now() - startedAt < HARD_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (closed) break;

      const next = await withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<RunRow>(
          `SELECT r.*
           FROM ops.run r
           JOIN ops.goal g ON g.id = r.goal_id
           WHERE r.id = $1 AND g.org_id = $2`,
          [req.params.id, scope.org_id],
        );
        return rows[0];
      });
      if (!next) break;

      const projected = projectRun(next);
      if (!shallowEqual(projected, last)) {
        send("snapshot", projected);
        last = projected;
      }

      if (TERMINAL.has(next.status)) {
        send("done", { status: next.status });
        break;
      }

      // Lightweight keep-alive comment every loop tick. Comments are
      // ignored by the EventSource client but keep proxies from idling.
      reply.raw.write(`: keepalive\n\n`);
    }

    if (!closed) reply.raw.end();
    return reply;
  });

  // -- cancel -------------------------------------------------------------
  /* Helpers exposed only inside this route module — kept local so the
     SSE stream and the cancel endpoint share their projection logic. */
  function projectRun(r: RunRow): {
    status: string;
    output: Record<string, unknown> | null;
    error: string | null;
    started_at: string | null;
    finished_at: string | null;
  } {
    return {
      status: r.status,
      output: r.output,
      error: r.error,
      started_at: r.started_at,
      finished_at: r.finished_at,
    };
  }

  function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const av = a[k];
      const bv = b[k];
      if (av === null && bv === null) continue;
      if (av === bv) continue;
      // Compare JSON for objects/arrays (output is a JSONB).
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
    }
    return true;
  }

  app.post<{ Params: { id: string } }>("/api/runs/:id/cancel", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<RunRow>(
        `UPDATE ops.run r
         SET status = 'cancelled', finished_at = now()
         FROM ops.goal g
         WHERE r.id = $1 AND r.goal_id = g.id AND g.org_id = $2
           AND r.status IN ('queued', 'running')
         RETURNING r.*`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      const run = rows[0]!;
      await audit(
        {
          scope,
          action: "run.cancel",
          target_type: "run",
          target_id: run.id,
          metadata: { goal_id: run.goal_id },
        },
        client,
      );
      return run;
    });
    if (!result) {
      return reply.code(409).send({ error: "not_cancellable_or_not_found" });
    }
    return result;
  });
}
