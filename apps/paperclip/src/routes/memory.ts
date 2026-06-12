/**
 * Memory Explorer — Phase 9.3.
 *
 * Read-only surface over the three memory layers we already have:
 *
 *   Layer 1 — Identity      ops.knowledge_doc (scope=company, hot=true).
 *                           These are the "always loaded" docs Hermes
 *                           pulls into every system prompt.
 *
 *   Layer 2 — Context       ops.goal_context (Phase 9.1). One row per
 *                           goal. Loaded into runs scoped to that goal.
 *
 *   Layer 3 — History       brain.memory. The narrative timeline —
 *                           Hermes' episodes plus the wrap-ups from
 *                           Phase 9.2. Bounded to the most recent N
 *                           rows so the explorer stays cheap.
 *
 * Single endpoint returns all three layers in one round-trip. The UI
 * renders whichever sections have rows; everything else is read-only
 * (editing flows live in Settings → Voice & Governance for identity
 * and Goal Detail for per-goal context).
 *
 *   GET /api/memory/explore?history_limit=N
 */

import type { FastifyInstance } from "fastify";

import { withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";

type IdentityRow = {
  id: string;
  slug: string;
  title: string;
  scope: string;
  hot: boolean;
  content_md: string;
  tags: string[];
  updated_at: string;
};

type ContextRow = {
  goal_id: string;
  goal_title: string;
  goal_kind: string;
  goal_status: string;
  content_md: string;
  content_hash: string | null;
  updated_at: string;
};

type HistoryRow = {
  id: string;
  goal_id: string | null;
  goal_title: string | null;
  kind: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type MemoryExploreResponse = {
  identity: IdentityRow[];
  context: ContextRow[];
  history: HistoryRow[];
};

const HISTORY_DEFAULT = 30;
const HISTORY_MAX = 200;

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { history_limit?: string } }>(
    "/api/memory/explore",
    async (req) => {
      const scope = await resolveCallerScope(req);
      const historyLimit = Math.min(
        Math.max(Number(req.query.history_limit ?? HISTORY_DEFAULT), 1),
        HISTORY_MAX,
      );

      return withOrgScope(scope.org_id, async (client) => {
        const [identity, context, history] = await Promise.all([
          client.query<IdentityRow>(
            `SELECT id, slug, title, scope::text, hot, content_md, tags, updated_at
               FROM ops.knowledge_doc
              WHERE org_id = $1
                AND (hot = true OR scope = 'company')
              ORDER BY hot DESC, updated_at DESC
              LIMIT 50`,
            [scope.org_id],
          ),
          client.query<ContextRow>(
            `SELECT c.goal_id,
                    g.title  AS goal_title,
                    g.kind::text AS goal_kind,
                    g.status::text AS goal_status,
                    c.content_md,
                    c.content_hash,
                    c.updated_at
               FROM ops.goal_context c
               JOIN ops.goal g ON g.id = c.goal_id
              WHERE c.org_id = $1
                AND length(c.content_md) > 0
              ORDER BY c.updated_at DESC
              LIMIT 50`,
            [scope.org_id],
          ),
          client.query<HistoryRow>(
            `SELECT m.id::text,
                    m.goal_id,
                    g.title AS goal_title,
                    m.kind::text,
                    m.title,
                    m.content,
                    m.metadata,
                    m.created_at
               FROM brain.memory m
          LEFT JOIN ops.goal g ON g.id = m.goal_id
              WHERE m.org_id = $1
              ORDER BY m.created_at DESC
              LIMIT $2`,
            [scope.org_id, historyLimit],
          ),
        ]);

        const out: MemoryExploreResponse = {
          identity: identity.rows,
          context: context.rows,
          history: history.rows,
        };
        return out;
      });
    },
  );
}
