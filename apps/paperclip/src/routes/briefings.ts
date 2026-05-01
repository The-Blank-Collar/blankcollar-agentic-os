/**
 * Briefings — generated editorial summaries.
 *
 * GET  /api/briefing/today      → fetch today's briefing (or generate on demand if none yet)
 * GET  /api/briefing            → recent briefings
 * POST /api/briefing/generate   → force-generate a new briefing
 *
 * The morning ritual: open the app, read what happened, see what wants you,
 * everything else has been moving without you.
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { type Briefing, type BriefingKind, composeBriefing } from "../briefing.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import { BriefingGenerate, BriefingListQuery, type Scope } from "../schemas.js";

type BriefingRow = {
  id: string;
  org_id: string;
  kind: string;
  generated_at: string;
  period_start: string | null;
  period_end: string | null;
  summary_md: string;
  sources: Record<string, unknown>;
  audio_url: string | null;
};

const BRIEFING_COLUMNS = "id, org_id, kind, generated_at, period_start, period_end, summary_md, sources, audio_url";

async function persist(scope: Scope, b: Briefing): Promise<BriefingRow> {
  return withOrgScope(scope.org_id, async (client) => {
    const { rows } = await client.query<BriefingRow>(
      `INSERT INTO ops.briefing (org_id, kind, period_start, period_end, summary_md, sources)
       VALUES ($1, $2::ops.briefing_kind, $3, $4, $5, $6::jsonb)
       RETURNING ${BRIEFING_COLUMNS}`,
      [scope.org_id, b.kind, b.period_start, b.period_end, b.summary_md, JSON.stringify(b.sources)],
    );
    const row = rows[0]!;
    await audit(
      {
        scope,
        action: "briefing.generate",
        target_type: "briefing",
        target_id: row.id,
        metadata: { kind: b.kind, hours: b.sources.hours },
      },
      client,
    );
    return row;
  });
}

export async function briefingRoutes(app: FastifyInstance): Promise<void> {
  // -- today (fetch or generate) ------------------------------------------
  app.get("/api/briefing/today", async (req) => {
    const scope = await resolveCallerScope(req);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const existing = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<BriefingRow>(
        `SELECT ${BRIEFING_COLUMNS}
           FROM ops.briefing
          WHERE org_id = $1 AND kind = 'daily' AND generated_at >= $2
          ORDER BY generated_at DESC LIMIT 1`,
        [scope.org_id, todayStart.toISOString()],
      );
      return rows;
    });
    if (existing.length > 0) return existing[0];

    const composed = await composeBriefing(scope.org_id, "daily");
    return persist(scope, composed);
  });

  // -- list ---------------------------------------------------------------
  app.get("/api/briefing", async (req, reply) => {
    const parsed = BriefingListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const where: string[] = ["org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (parsed.data.kind) {
      params.push(parsed.data.kind);
      where.push(`kind = $${params.length}::ops.briefing_kind`);
    }
    params.push(parsed.data.limit);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<BriefingRow>(
        `SELECT ${BRIEFING_COLUMNS}
           FROM ops.briefing
          WHERE ${where.join(" AND ")}
          ORDER BY generated_at DESC
          LIMIT $${params.length}`,
        params,
      );
      return rows;
    });
  });

  // -- generate (force) ---------------------------------------------------
  app.post("/api/briefing/generate", async (req, reply) => {
    const parsed = BriefingGenerate.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const composed = await composeBriefing(
      scope.org_id,
      parsed.data.kind as BriefingKind,
      parsed.data.period_hours,
    );
    const row = await persist(scope, composed);
    return reply.code(201).send(row);
  });
}
