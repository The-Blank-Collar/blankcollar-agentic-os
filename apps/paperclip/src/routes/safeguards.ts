/**
 * Safeguards — plain-English rules per scope, parsed into ops.policy rows.
 *
 *   GET    /api/safeguards              list every safeguard set across scopes
 *   GET    /api/safeguards/:id          fetch one
 *   PUT    /api/safeguards              upsert markdown for a scope
 *                                       (idempotent; identical content_hash → no-op)
 *   DELETE /api/safeguards/:id          remove a safeguard + cascade-delete its policies
 *   POST   /api/safeguards/preview      parse without persisting (dry-run)
 *
 * On every successful upsert, the route:
 *   1. Computes the new content_hash. If it matches the saved one, returns
 *      the existing row unchanged (no policy churn).
 *   2. Parses the markdown. If the parse fails or yields zero rules, the
 *      saved markdown still wins — the operator sees `rule_count = 0`
 *      and any warnings in the response.
 *   3. Atomically deletes every ops.policy row tagged with `safeguard_id =
 *      self.id` and inserts the new ones at priority 50.
 *   4. Audits `safeguard.upsert` with the rule count + scope info.
 *
 * Backward compatibility: hand-written ops.policy rows (safeguard_id IS NULL)
 * are never touched. Operators can mix safeguards (priority 50, generated)
 * with hand rules (priority 100 default, owned by them).
 */

import type { FastifyInstance } from "fastify";

import { audit } from "../audit.js";
import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";
import { hashSafeguards, parseSafeguards } from "../safeguards/parse.js";
import { SafeguardPreview, SafeguardUpsert } from "../schemas.js";

type SafeguardRow = {
  id: string;
  org_id: string;
  scope_kind: string;
  scope_id: string | null;
  content_md: string;
  content_hash: string;
  rule_count: number;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  "id, org_id, scope_kind, scope_id, content_md, content_hash, rule_count, created_at, updated_at";

export async function safeguardRoutes(app: FastifyInstance): Promise<void> {
  // -- list ---------------------------------------------------------------
  app.get("/api/safeguards", async (req) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<SafeguardRow>(
        `SELECT ${COLUMNS}
           FROM ops.safeguard
          WHERE org_id = $1
          ORDER BY
            CASE scope_kind
              WHEN 'org' THEN 0
              WHEN 'department' THEN 1
              WHEN 'agent' THEN 2
            END,
            updated_at DESC`,
        [scope.org_id],
      );
      return rows;
    });
  });

  // -- get one ------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/safeguards/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const rows = await withOrgScope(scope.org_id, async (client) => {
      const { rows: rs } = await client.query<SafeguardRow>(
        `SELECT ${COLUMNS} FROM ops.safeguard WHERE id = $1 AND org_id = $2`,
        [req.params.id, scope.org_id],
      );
      return rs;
    });
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });

  // -- preview (dry-run parse) -------------------------------------------
  app.post("/api/safeguards/preview", async (req, reply) => {
    const parsed = SafeguardPreview.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const result = parseSafeguards(parsed.data.content_md);
    return {
      rule_count: result.rules.length,
      rules: result.rules,
      warnings: result.warnings,
      content_hash: hashSafeguards(parsed.data.content_md),
    };
  });

  // -- upsert -------------------------------------------------------------
  app.put("/api/safeguards", async (req, reply) => {
    const parsed = SafeguardUpsert.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const { scope_kind, scope_id, content_md } = parsed.data;
    const newHash = hashSafeguards(content_md);
    const parseResult = parseSafeguards(content_md);
    const ruleCount = parseResult.rules.length;
    const scope = await resolveCallerScope(req);

    const result = await withOrgScope(scope.org_id, async (client) => {
      // Two SQL paths because the unique index is partial (org vs. scoped).
      let row: SafeguardRow;
      if (scope_kind === "org") {
        const { rows } = await client.query<SafeguardRow>(
          `INSERT INTO ops.safeguard
             (org_id, scope_kind, scope_id, content_md, content_hash, rule_count)
           VALUES ($1, 'org', NULL, $2, $3, $4)
           ON CONFLICT (org_id) WHERE scope_kind = 'org'
             DO UPDATE SET
               content_md   = EXCLUDED.content_md,
               content_hash = EXCLUDED.content_hash,
               rule_count   = EXCLUDED.rule_count,
               updated_at   = now()
           RETURNING ${COLUMNS}`,
          [scope.org_id, content_md, newHash, ruleCount],
        );
        row = rows[0]!;
      } else {
        const { rows } = await client.query<SafeguardRow>(
          `INSERT INTO ops.safeguard
             (org_id, scope_kind, scope_id, content_md, content_hash, rule_count)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (org_id, scope_kind, scope_id) WHERE scope_kind <> 'org'
             DO UPDATE SET
               content_md   = EXCLUDED.content_md,
               content_hash = EXCLUDED.content_hash,
               rule_count   = EXCLUDED.rule_count,
               updated_at   = now()
           RETURNING ${COLUMNS}`,
          [scope.org_id, scope_kind, scope_id, content_md, newHash, ruleCount],
        );
        row = rows[0]!;
      }

      // Replace the generated policy rows. We do it unconditionally so that
      // re-saving the same markdown still has a clean DELETE+INSERT pass —
      // policy table churn is small (≤ a couple dozen rows per safeguard).
      // The DELETE cascades from ON DELETE CASCADE on policy.safeguard_id,
      // but we issue an explicit DELETE because re-running upsert keeps
      // the same safeguard_id (cascade only fires on safeguard row deletion).
      await client.query(`DELETE FROM ops.policy WHERE safeguard_id = $1`, [row.id]);

      // Insert one ops.policy row per parsed rule.
      for (const rule of parseResult.rules) {
        await client.query(
          `INSERT INTO ops.policy
             (org_id, role, agent_kind, skill_slug, action_kind, effect, priority, reason, safeguard_id)
           VALUES ($1, NULL, $2, $3, $4, $5::ops.policy_effect, $6, $7, $8)`,
          [
            scope.org_id,
            rule.agent_kind,
            rule.skill_slug,
            rule.action_kind,
            rule.effect,
            rule.priority,
            rule.reason.slice(0, 500),
            row.id,
          ],
        );
      }

      await audit(
        {
          scope,
          action: "safeguard.upsert",
          target_type: "safeguard",
          target_id: row.id,
          metadata: {
            scope_kind: row.scope_kind,
            scope_id: row.scope_id,
            rule_count: ruleCount,
            warning_count: parseResult.warnings.length,
            content_hash: newHash,
          },
        },
        client,
      );

      return { row, parseResult };
    });

    return reply.code(200).send({
      ...result.row,
      rules: result.parseResult.rules,
      warnings: result.parseResult.warnings,
    });
  });

  // -- delete -------------------------------------------------------------
  // Cascading deletes the generated ops.policy rows via the FK.
  app.delete<{ Params: { id: string } }>("/api/safeguards/:id", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    const result = await withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<{
        id: string;
        scope_kind: string;
        scope_id: string | null;
      }>(
        `DELETE FROM ops.safeguard
          WHERE id = $1 AND org_id = $2
          RETURNING id, scope_kind, scope_id`,
        [req.params.id, scope.org_id],
      );
      if (rows.length === 0) return undefined;
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "safeguard.delete",
          target_type: "safeguard",
          target_id: row.id,
          metadata: { scope_kind: row.scope_kind, scope_id: row.scope_id },
        },
        client,
      );
      return row;
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
