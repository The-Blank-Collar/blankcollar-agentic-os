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

type DepartmentRow = { id: string; name: string; slug?: string };

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>("/api/orgs/by-slug/:slug", async (req, reply) => {
    const { rows } = await query<OrgRow>(
      "SELECT id, slug, name, created_at FROM core.organization WHERE slug = $1",
      [req.params.slug],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "not_found" });
    return rows[0];
  });

  // -- departments --------------------------------------------------------
  // Lists every department in the caller's org, with goal counts so the
  // frontend org-overview tab + bc depts can show the topology at a glance.
  app.get("/api/departments", async (req) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<{
        id: string;
        slug: string;
        name: string;
        created_at: string;
        goal_count: string;
      }>(
        `SELECT d.id, d.slug, d.name, d.created_at,
                (SELECT COUNT(*)::text FROM ops.goal g
                  WHERE g.department_id = d.id AND g.status IN ('active','draft'))
                                                              AS goal_count
           FROM core.department d
          WHERE d.org_id = $1
          ORDER BY d.name ASC`,
        [scope.org_id],
      );
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        created_at: r.created_at,
        active_goal_count: Number(r.goal_count ?? "0"),
      }));
    });
  });

  // -- whoami -------------------------------------------------------------
  // Returns the resolved scope of the caller — org, role, department —
  // alongside the org's slug + display name. Backs the `bc whoami` CLI
  // and the design's status-bar "you are …" rail.
  app.get("/api/whoami", async (req) => {
    const scope = await resolveCallerScope(req);
    const auth = req.bcAuth;
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

      // User identity. In auth-on mode this comes from the verified JWT;
      // in demo mode we surface a synthetic owner row so the UI can
      // render an avatar without branching everywhere.
      type UserRow = { id: string; email: string | null; full_name: string | null };
      let user: UserRow | null = null;
      if (auth?.email) {
        const { rows: ur } = await client.query<UserRow>(
          "SELECT id, email, full_name FROM core.user_account WHERE email = $1 AND org_id = $2",
          [auth.email, scope.org_id],
        );
        user = ur[0] ?? null;
      }
      return {
        org: org
          ? { id: org.id, slug: org.slug, name: org.name }
          : { id: scope.org_id, slug: null, name: null },
        role: scope.role,
        department,
        goal_id: scope.goal_id,
        user,
        mode: auth?.verified ? ("verified" as const) : ("demo" as const),
      };
    });
  });

  // -- bootstrap ----------------------------------------------------------
  // Idempotent. Creates the caller's org + owner role + seed pack if no
  // account exists for their verified email; otherwise resolves to the
  // existing scope. The auth preHandler already auto-bootstraps on first
  // sign-in (gated by PAPERCLIP_AUTO_BOOTSTRAP), but this endpoint gives
  // the client an explicit "make sure I'm provisioned" call to fire
  // immediately after sign-up.
  app.post<{ Body: { full_name?: string; org_name?: string } }>(
    "/api/orgs/bootstrap",
    async (req, reply) => {
      const auth = req.bcAuth;
      if (!auth?.email) {
        return reply.code(401).send({ error: "auth_required" });
      }
      const { bootstrapUserOrg } = await import("../orgs/bootstrap.js");
      const body = (req.body ?? {}) as { full_name?: string; org_name?: string };
      const result = await bootstrapUserOrg({
        email: auth.email,
        full_name: body.full_name ?? null,
        org_name: body.org_name ?? null,
      });
      return reply.code(result.created ? 201 : 200).send(result);
    },
  );

  // -- members ------------------------------------------------------------
  // Lists the org's user_account rows + their role assignments. Used by
  // Settings/People and the audit-log explorer's "filter by actor" picker.
  app.get("/api/orgs/members", async (req) => {
    const scope = await resolveCallerScope(req);
    type MemberRow = {
      id: string;
      email: string;
      full_name: string | null;
      is_active: boolean;
      created_at: string;
      role: string | null;
      department_id: string | null;
      department_name: string | null;
    };
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<MemberRow>(
        `SELECT
            u.id, u.email, u.full_name, u.is_active, u.created_at,
            ra.role, ra.department_id,
            d.name AS department_name
         FROM core.user_account u
         LEFT JOIN core.role_assignment ra ON ra.user_id = u.id
         LEFT JOIN core.department d ON d.id = ra.department_id
         WHERE u.org_id = $1
         ORDER BY
           CASE ra.role
             WHEN 'owner' THEN 0
             WHEN 'department_lead' THEN 1
             WHEN 'auditor' THEN 2
             WHEN 'team_member' THEN 3
             WHEN 'agent' THEN 4
             ELSE 9
           END,
           u.created_at`,
        [scope.org_id],
      );
      return rows;
    });
  });
}
