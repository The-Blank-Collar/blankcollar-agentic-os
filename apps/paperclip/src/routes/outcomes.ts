/**
 * Outcomes API.
 *
 *   POST   /api/runs/:id/outcomes              record an outcome from a run
 *   GET    /api/outcomes                       list (filter by skill / agent / kind)
 *   GET    /api/outcomes/:id                   fetch one
 *   POST   /api/outcomes/:id/metrics           record a metric
 *   GET    /api/outcomes/:id/metrics           list metrics for an outcome
 *   GET    /api/outcomes/similar               retrieve top-N few-shot candidates
 *   DELETE /api/outcomes/:id                   delete (cascades metrics)
 *
 * Outcomes are the long-lived record of "what an agent produced." Metrics
 * accumulate over time as performance signals flow in (manual entry, a
 * Stripe / HubSpot webhook, an agent-derived metric like edit-distance).
 */

import type { FastifyInstance } from "fastify";

import { createHash } from "node:crypto";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { retrieveOutcomes } from "../outcomes/retrieve.js";
import {
  OutcomeCreate,
  OutcomeListQuery,
  OutcomeMetricCreate,
  OutcomeSimilarQuery,
  type Scope,
} from "../schemas.js";
import { resolveCallerScope } from "../scope.js";

type OutcomeRow = {
  id: string;
  org_id: string;
  run_id: string | null;
  goal_id: string | null;
  agent_kind: string | null;
  skill_slug: string | null;
  output_kind: string;
  title: string;
  content_md: string;
  content_hash: string;
  char_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type MetricRow = {
  id: string;
  outcome_id: string;
  name: string;
  value: string;
  unit: string | null;
  direction: string;
  source: string;
  recorded_at: string;
  metadata: Record<string, unknown>;
};

const OUTCOME_COLUMNS = `
  id, org_id, run_id, goal_id, agent_kind, skill_slug, output_kind,
  title, content_md, content_hash, char_count, metadata,
  created_at, updated_at
`;

const METRIC_COLUMNS = `
  id, outcome_id, name, value::text, unit, direction, source,
  recorded_at, metadata
`;

export async function outcomeRoutes(app: FastifyInstance): Promise<void> {
  // -- record from a run -------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/outcomes",
    async (req, reply) => {
      const parsed = OutcomeCreate.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const scope = await resolveCallerScope(req);
      const result = await withOrgScope(scope.org_id, async (client) => {
        // Verify the run belongs to this org via the goal join.
        const { rows: own } = await client.query<{ id: string; goal_id: string }>(
          `SELECT r.id, r.goal_id FROM ops.run r
             JOIN ops.goal g ON g.id = r.goal_id
            WHERE r.id = $1 AND g.org_id = $2`,
          [req.params.id, scope.org_id],
        );
        if (own.length === 0) return { kind: "not_found" as const };
        return await insertOutcome(client, scope.org_id, {
          run_id: req.params.id,
          goal_id: parsed.data.goal_id ?? own[0]!.goal_id,
          agent_kind: parsed.data.agent_kind ?? null,
          skill_slug: parsed.data.skill_slug ?? null,
          output_kind: parsed.data.output_kind,
          title: parsed.data.title,
          content_md: parsed.data.content_md,
          metadata: parsed.data.metadata ?? {},
          scope,
        });
      });
      if (result.kind === "not_found") return reply.code(404).send({ error: "run_not_found" });
      return reply.code(201).send(result.row);
    },
  );

  // -- list --------------------------------------------------------------
  app.get("/api/outcomes", async (req, reply) => {
    const parsed = OutcomeListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const where: string[] = ["org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (parsed.data.skill_slug) {
      params.push(parsed.data.skill_slug);
      where.push(`skill_slug = $${params.length}`);
    }
    if (parsed.data.agent_kind) {
      params.push(parsed.data.agent_kind);
      where.push(`agent_kind = $${params.length}`);
    }
    if (parsed.data.output_kind) {
      params.push(parsed.data.output_kind);
      where.push(`output_kind = $${params.length}`);
    }
    params.push(parsed.data.limit);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<OutcomeRow>(
        `SELECT ${OUTCOME_COLUMNS}
           FROM ops.outcome
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC
          LIMIT $${params.length}`,
        params,
      );
      return rows;
    });
  });

  // -- get one (with embedded metrics) ----------------------------------
  app.get<{ Params: { id: string } }>("/api/outcomes/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const data = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<OutcomeRow>(
        `SELECT ${OUTCOME_COLUMNS} FROM ops.outcome WHERE id = $1 AND org_id = $2`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return null;
      const { rows: metrics } = await client.query<MetricRow>(
        `SELECT ${METRIC_COLUMNS} FROM ops.outcome_metric
          WHERE outcome_id = $1 AND org_id = $2
          ORDER BY recorded_at DESC`,
        [req.params.id, scope.org_id],
      );
      return { ...rows[0]!, metrics };
    });
    if (!data) return reply.code(404).send({ error: "not_found" });
    return data;
  });

  // -- record metric -----------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/api/outcomes/:id/metrics",
    async (req, reply) => {
      const parsed = OutcomeMetricCreate.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }
      const scope = await resolveCallerScope(req);
      const result = await withOrgScope(scope.org_id, async (client) => {
        const { rows: own } = await client.query<{ id: string }>(
          `SELECT id FROM ops.outcome WHERE id = $1 AND org_id = $2`,
          [req.params.id, scope.org_id],
        );
        if (own.length === 0) return { kind: "not_found" as const };
        const { rows } = await client.query<MetricRow>(
          `INSERT INTO ops.outcome_metric
             (org_id, outcome_id, name, value, unit, direction, source, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
           RETURNING ${METRIC_COLUMNS}`,
          [
            scope.org_id,
            req.params.id,
            parsed.data.name,
            parsed.data.value,
            parsed.data.unit ?? null,
            parsed.data.direction,
            parsed.data.source,
            JSON.stringify(parsed.data.metadata ?? {}),
          ],
        );
        const row = rows[0]!;
        await audit(
          {
            scope,
            action: "outcome.metric.record",
            target_type: "outcome_metric",
            target_id: row.id,
            metadata: {
              outcome_id: req.params.id,
              name: row.name,
              value: parsed.data.value,
              direction: row.direction,
              source: row.source,
            },
          },
          client,
        );
        return { kind: "ok" as const, row };
      });
      if (result.kind === "not_found") return reply.code(404).send({ error: "outcome_not_found" });
      return reply.code(201).send(result.row);
    },
  );

  // -- list metrics for an outcome --------------------------------------
  app.get<{ Params: { id: string } }>(
    "/api/outcomes/:id/metrics",
    async (req) => {
      const scope = await resolveCallerScope(req);
      return withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<MetricRow>(
          `SELECT ${METRIC_COLUMNS} FROM ops.outcome_metric
            WHERE outcome_id = $1 AND org_id = $2
            ORDER BY recorded_at DESC`,
          [req.params.id, scope.org_id],
        );
        return rows;
      });
    },
  );

  // -- similar (few-shot retrieval preview) -----------------------------
  app.get("/api/outcomes/similar", async (req, reply) => {
    const parsed = OutcomeSimilarQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      return retrieveOutcomes(client, {
        orgId: scope.org_id,
        skillSlug: parsed.data.skill_slug ?? null,
        agentKind: parsed.data.agent_kind ?? null,
        outputKind: parsed.data.output_kind ?? null,
        topN: parsed.data.top_n,
        poolSize: parsed.data.pool_size,
      });
    });
  });

  // -- delete ------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/api/outcomes/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<{ id: string; output_kind: string }>(
        `DELETE FROM ops.outcome WHERE id = $1 AND org_id = $2
          RETURNING id, output_kind`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "outcome.delete",
          target_type: "outcome",
          target_id: row.id,
          metadata: { output_kind: row.output_kind },
        },
        client,
      );
      return row;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}

// -- internals -------------------------------------------------------------

async function insertOutcome(
  client: import("pg").PoolClient,
  orgId: string,
  input: {
    run_id: string | null;
    goal_id: string | null;
    agent_kind: string | null;
    skill_slug: string | null;
    output_kind: string;
    title: string;
    content_md: string;
    metadata: Record<string, unknown>;
    scope: Scope;
  },
): Promise<{ kind: "ok"; row: OutcomeRow }> {
  const hash = createHash("sha256").update(input.content_md).digest("hex");
  const { rows } = await client.query<OutcomeRow>(
    `INSERT INTO ops.outcome
       (org_id, run_id, goal_id, agent_kind, skill_slug, output_kind,
        title, content_md, content_hash, char_count, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     RETURNING ${OUTCOME_COLUMNS}`,
    [
      orgId,
      input.run_id,
      input.goal_id,
      input.agent_kind,
      input.skill_slug,
      input.output_kind,
      input.title.slice(0, 500),
      input.content_md,
      hash,
      input.content_md.length,
      JSON.stringify(input.metadata),
    ],
  );
  const row = rows[0]!;
  await audit(
    {
      scope: input.scope,
      action: "outcome.record",
      target_type: "outcome",
      target_id: row.id,
      metadata: {
        run_id: input.run_id,
        skill_slug: input.skill_slug,
        agent_kind: input.agent_kind,
        output_kind: input.output_kind,
        char_count: row.char_count,
      },
    },
    client,
  );
  return { kind: "ok", row };
}
