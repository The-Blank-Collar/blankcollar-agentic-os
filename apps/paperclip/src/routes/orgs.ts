/** Tiny helper endpoint used by email-ingest (and future services). */

import type { FastifyInstance } from "fastify";

import { query, withOrgScope } from "../db.js";
import { resolveCallerScope } from "../scope.js";

type OrgRow = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
};

type DepartmentRow = { id: string; name: string };

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>("/api/orgs/by-slug/:slug", async (req, reply) => {
    const { rows } = await query<OrgRow>(
      "SELECT id, slug, name, created_at FROM core.organization WHERE slug = $1",
      [req.params.slug],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });

  // -- whoami -------------------------------------------------------------
  // Returns the resolved scope of the caller — org, role, department —
  // alongside the org's slug + display name. Backs the `bc whoami` CLI
  // and the design's status-bar "you are …" rail.
  app.get("/api/whoami", async (req) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows: orgs } = await client.query<OrgRow>(
        "SELECT id, slug, name, created_at FROM core.organization WHERE id = $1",
        [scope.org_id],
      );
      const org = orgs[0];
      let department: DepartmentRow | null = null;
      if (scope.department_id) {
        const { rows: depts } = await client.query<DepartmentRow>(
          "SELECT id, name FROM core.department WHERE id = $1 AND org_id = $2",
          [scope.department_id, scope.org_id],
        );
        department = depts[0] ?? null;
      }
      return {
        org: org
          ? { id: org.id, slug: org.slug, name: org.name }
          : { id: scope.org_id, slug: null, name: null },
        role: scope.role,
        department,
        goal_id: scope.goal_id,
      };
    });
  });
}
