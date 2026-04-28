/** Tiny helper endpoint used by email-ingest (and future services). */

import type { FastifyInstance } from "fastify";

import { query } from "../db.js";

type OrgRow = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
};

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>("/api/orgs/by-slug/:slug", async (req, reply) => {
    const { rows } = await query<OrgRow>(
      "SELECT id, slug, name, created_at FROM core.organization WHERE slug = $1",
      [req.params.slug],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });
}
