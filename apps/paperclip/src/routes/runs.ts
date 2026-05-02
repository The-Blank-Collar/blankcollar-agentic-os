import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { RunFeedbackCreate } from "../schemas.js";
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

  // -- feedback (Phase 2.3.a) --------------------------------------------
  // Per-run rating (1-5) + tags + free-form note. Multiple feedback entries
  // per run are allowed (operator may refine after re-reading).

  type FeedbackRow = {
    id: string;
    run_id: string;
    org_id: string;
    user_id: string | null;
    rating: number;
    tags: string[];
    note: string | null;
    created_at: string;
  };
  const FEEDBACK_COLUMNS = "id, run_id, org_id, user_id, rating, tags, note, created_at";

  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/feedback",
    async (req, reply) => {
      const parsed = RunFeedbackCreate.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const scope = await resolveCallerScope(req);
      const result = await withOrgScope(scope.org_id, async (client) => {
        // Confirm the run belongs to this org (via the run→goal join).
        const { rows: own } = await client.query<{ id: string }>(
          `SELECT r.id FROM ops.run r
             JOIN ops.goal g ON g.id = r.goal_id
            WHERE r.id = $1 AND g.org_id = $2`,
          [req.params.id, scope.org_id],
        );
        if (own.length === 0) return { kind: "not_found" as const };

        const { rows } = await client.query<FeedbackRow>(
          `INSERT INTO ops.run_feedback
             (run_id, org_id, user_id, rating, tags, note)
           VALUES ($1, $2, $3, $4, $5::text[], $6)
           RETURNING ${FEEDBACK_COLUMNS}`,
          [
            req.params.id,
            scope.org_id,
            null, // Phase 6: scope.user_id once auth is wired
            parsed.data.rating,
            parsed.data.tags,
            parsed.data.note ?? null,
          ],
        );
        const fb = rows[0]!;
        await audit(
          {
            scope,
            action: "run.feedback",
            target_type: "run",
            target_id: req.params.id,
            metadata: {
              feedback_id: fb.id,
              rating: fb.rating,
              tags: fb.tags,
              has_note: Boolean(fb.note),
            },
          },
          client,
        );
        return { kind: "ok" as const, feedback: fb };
      });
      if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
      return reply.code(201).send(result.feedback);
    },
  );

  app.get<{ Params: { id: string } }>("/api/runs/:id/feedback", async (req) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<FeedbackRow>(
        `SELECT ${FEEDBACK_COLUMNS}
           FROM ops.run_feedback
          WHERE run_id = $1 AND org_id = $2
          ORDER BY created_at DESC`,
        [req.params.id, scope.org_id],
      );
      return rows;
    });
  });

  app.delete<{ Params: { id: string } }>("/api/runs/feedback/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<{ id: string; run_id: string }>(
        `DELETE FROM ops.run_feedback
          WHERE id = $1 AND org_id = $2
          RETURNING id, run_id`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      await audit(
        {
          scope,
          action: "run.feedback.delete",
          target_type: "run_feedback",
          target_id: rows[0]!.id,
          metadata: { run_id: rows[0]!.run_id },
        },
        client,
      );
      return rows[0];
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
