/**
 * Invitations — Phase 6.b.
 *
 * Two surfaces:
 *
 *   1. Authenticated org routes (under `/api/invitations`):
 *      - POST   /api/invitations           — create
 *      - GET    /api/invitations           — list
 *      - POST   /api/invitations/:id/revoke
 *      - POST   /api/invitations/:id/resend
 *
 *   2. Public token routes (no auth — the recipient may not have an
 *      account yet). Tokens are opaque 64-char hex strings, single-use:
 *      - GET    /api/invitations/by-token/:token
 *      - POST   /api/invitations/by-token/:token/accept
 *
 * Acceptance creates (or finds) a `core.user_account` row and writes a
 * `core.role_assignment`. The invitation's status flips to `accepted`,
 * which clears the partial-unique pending index — re-invites are allowed
 * later if the user is removed.
 *
 * v0 trust model (matches Phase 6.0): when SUPABASE_JWT_SECRET is unset,
 * possession of the token IS the auth. When auth is enforced, we
 * additionally require the verified email to match the invitation.
 */

import { randomBytes } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type pg from "pg";

import { audit } from "../audit.js";
import { config } from "../config.js";
import { withOrgScope, withSystemScope } from "../db.js";
import { send as sendMail } from "../mail/index.js";
import { invitation as invitationTemplate } from "../mail/templates.js";
import {
  InvitableRole,
  InvitationAccept,
  InvitationCreate,
  InvitationListQuery,
} from "../schemas.js";
import { resolveCallerScope } from "../scope.js";

type InvitationRow = {
  id: string;
  org_id: string;
  email: string;
  role: string;
  department_id: string | null;
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  invited_by_user_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  department_name?: string | null;
  org_slug?: string | null;
  org_name?: string | null;
};

const INVITATION_COLUMNS =
  "id, org_id, email, role, department_id, token, status, invited_by_user_id, " +
  "expires_at, accepted_at, created_at, updated_at";

function newToken(): string {
  return randomBytes(32).toString("hex");
}

async function dispatchInviteMail(
  client: pg.PoolClient,
  row: InvitationRow,
): Promise<void> {
  // Best-effort. Failures never block the route.
  try {
    const { rows } = await client.query<{ org_name: string; inviter_name: string | null }>(
      `SELECT o.name AS org_name,
              COALESCE(u.full_name, u.display_name, u.email) AS inviter_name
         FROM core.organization o
    LEFT JOIN core.user_account u ON u.id = $2
        WHERE o.id = $1`,
      [row.org_id, row.invited_by_user_id],
    );
    const ctx = rows[0] ?? { org_name: "the studio", inviter_name: null };
    void sendMail({
      to: row.email,
      ...invitationTemplate({
        email: row.email,
        inviter_name: ctx.inviter_name,
        org_name: ctx.org_name,
        role: row.role,
        invite_url: inviteUrl(row.token),
        expires_at: row.expires_at,
      }),
    }).catch(() => {
      /* provider already logs */
    });
  } catch {
    /* swallow */
  }
}

function inviteUrl(token: string): string {
  const base =
    process.env.WEBSITE_PUBLIC_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
  return `${base}/?invite=${token}`;
}

function projectInvitation(
  row: InvitationRow,
  opts: { withToken?: boolean; withInviteUrl?: boolean } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: row.id,
    org_id: row.org_id,
    email: row.email,
    role: row.role,
    department_id: row.department_id,
    department_name: row.department_name ?? null,
    status: row.status,
    invited_by_user_id: row.invited_by_user_id,
    expires_at: row.expires_at,
    accepted_at: row.accepted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (opts.withToken) out.token = row.token;
  if (opts.withInviteUrl) out.invite_url = inviteUrl(row.token);
  return out;
}

export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  // -- create --------------------------------------------------------------
  app.post("/api/invitations", async (req, reply) => {
    const parsed = InvitationCreate.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const email = parsed.data.email.trim().toLowerCase();

    if (parsed.data.department_id) {
      const ok = await withOrgScope(scope.org_id, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          "SELECT id FROM core.department WHERE id = $1 AND org_id = $2",
          [parsed.data.department_id, scope.org_id],
        );
        return rows.length > 0;
      });
      if (!ok) return reply.code(400).send({ error: "department_not_found" });
    }

    return withOrgScope(scope.org_id, async (client) => {
      try {
        const { rows } = await client.query<InvitationRow>(
          `INSERT INTO core.invitation
             (org_id, email, role, department_id, token, invited_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${INVITATION_COLUMNS}`,
          [
            scope.org_id,
            email,
            parsed.data.role,
            parsed.data.department_id ?? null,
            newToken(),
            req.bcAuth?.sub ?? null,
          ],
        );
        const row = rows[0]!;
        await audit(
          {
            scope,
            action: "invitation.create",
            target_type: "invitation",
            target_id: row.id,
            metadata: { email, role: parsed.data.role, department_id: parsed.data.department_id ?? null },
          },
          client,
        );
        await dispatchInviteMail(client, row);
        return reply.code(201).send(projectInvitation(row, { withToken: true, withInviteUrl: true }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/invitation_pending_uniq/.test(message)) {
          return reply.code(409).send({
            error: "invitation_pending",
            hint: "An invitation for this email is already pending. Revoke it first or use resend.",
          });
        }
        throw err;
      }
    });
  });

  // -- list ----------------------------------------------------------------
  app.get("/api/invitations", async (req, reply) => {
    const parsed = InvitationListQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }
    const scope = await resolveCallerScope(req);
    const where: string[] = ["i.org_id = $1"];
    const params: unknown[] = [scope.org_id];
    if (parsed.data.status) {
      params.push(parsed.data.status);
      where.push(`i.status = $${params.length}::core.invitation_status`);
    }
    params.push(parsed.data.limit);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<InvitationRow>(
        `SELECT i.id, i.org_id, i.email, i.role, i.department_id, i.token, i.status,
                i.invited_by_user_id, i.expires_at, i.accepted_at, i.created_at, i.updated_at,
                d.name AS department_name
           FROM core.invitation i
      LEFT JOIN core.department d ON d.id = i.department_id
          WHERE ${where.join(" AND ")}
          ORDER BY i.created_at DESC
          LIMIT $${params.length}`,
        params,
      );
      return rows.map((r) => projectInvitation(r, { withInviteUrl: true }));
    });
  });

  // -- revoke --------------------------------------------------------------
  app.post<{ Params: { id: string } }>("/api/invitations/:id/revoke", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<InvitationRow>(
        `UPDATE core.invitation
            SET status = 'revoked'::core.invitation_status, updated_at = now()
          WHERE id = $1 AND status = 'pending'::core.invitation_status
        RETURNING ${INVITATION_COLUMNS}`,
        [req.params.id],
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: "not_found_or_not_pending" });
      }
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "invitation.revoke",
          target_type: "invitation",
          target_id: row.id,
          metadata: { email: row.email },
        },
        client,
      );
      return projectInvitation(row, { withInviteUrl: true });
    });
  });

  // -- resend --------------------------------------------------------------
  // Rotates the token (old link stops working) and bumps expires_at.
  app.post<{ Params: { id: string } }>("/api/invitations/:id/resend", async (req, reply) => {
    const scope = await resolveCallerScope(req);
    return withOrgScope(scope.org_id, async (client) => {
      const { rows } = await client.query<InvitationRow>(
        `UPDATE core.invitation
            SET token = $2,
                expires_at = now() + interval '7 days',
                status = 'pending'::core.invitation_status,
                updated_at = now()
          WHERE id = $1
            AND status IN ('pending'::core.invitation_status, 'expired'::core.invitation_status)
        RETURNING ${INVITATION_COLUMNS}`,
        [req.params.id, newToken()],
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: "not_found_or_already_accepted_or_revoked" });
      }
      const row = rows[0]!;
      await audit(
        {
          scope,
          action: "invitation.resend",
          target_type: "invitation",
          target_id: row.id,
          metadata: { email: row.email },
        },
        client,
      );
      await dispatchInviteMail(client, row);
      return projectInvitation(row, { withToken: true, withInviteUrl: true });
    });
  });

  // -- public lookup (recipient lands here) -------------------------------
  app.get<{ Params: { token: string } }>(
    "/api/invitations/by-token/:token",
    async (req, reply) => {
      const token = req.params.token;
      if (!/^[a-f0-9]{32,128}$/.test(token)) {
        return reply.code(400).send({ error: "invalid_token_format" });
      }
      const row = await withSystemScope(async (client) => {
        const { rows } = await client.query<InvitationRow>(
          `SELECT i.id, i.org_id, i.email, i.role, i.department_id, i.token, i.status,
                  i.invited_by_user_id, i.expires_at, i.accepted_at, i.created_at, i.updated_at,
                  o.slug  AS org_slug,
                  o.name  AS org_name,
                  d.name  AS department_name
             FROM core.invitation i
        LEFT JOIN core.organization o ON o.id = i.org_id
        LEFT JOIN core.department   d ON d.id = i.department_id
            WHERE i.token = $1`,
          [token],
        );
        return rows[0];
      });
      if (!row) return reply.code(404).send({ error: "not_found" });

      // Mark pending invitations expired on the fly. Read-only here — caller
      // may still see the row but with status='expired'.
      const now = Date.now();
      const expired = row.status === "pending" && new Date(row.expires_at).getTime() < now;
      const status = expired ? ("expired" as const) : row.status;

      return reply.send({
        id: row.id,
        email: row.email,
        role: row.role,
        org: { slug: row.org_slug, name: row.org_name },
        department: row.department_id
          ? { id: row.department_id, name: row.department_name ?? null }
          : null,
        status,
        expires_at: row.expires_at,
        invited_at: row.created_at,
      });
    },
  );

  // -- public accept ------------------------------------------------------
  app.post<{ Params: { token: string }; Body: unknown }>(
    "/api/invitations/by-token/:token/accept",
    async (req, reply) => {
      const token = req.params.token;
      if (!/^[a-f0-9]{32,128}$/.test(token)) {
        return reply.code(400).send({ error: "invalid_token_format" });
      }
      const parsed = InvitationAccept.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      }

      // Public path runs under system scope so we can find the invitation
      // before the org context is established. Once we have the org_id, all
      // remaining writes happen inside withOrgScope so RLS stays enforced.
      const inv = await withSystemScope(async (client) => {
        const { rows } = await client.query<InvitationRow>(
          `SELECT ${INVITATION_COLUMNS}
             FROM core.invitation
            WHERE token = $1`,
          [token],
        );
        return rows[0];
      });
      if (!inv) return reply.code(404).send({ error: "not_found" });
      if (inv.status !== "pending") {
        return reply.code(409).send({ error: `invitation_${inv.status}` });
      }
      if (new Date(inv.expires_at).getTime() < Date.now()) {
        return reply.code(409).send({ error: "invitation_expired" });
      }

      // Auth-enforced installs require the verified email to match.
      if (config.authEnforce) {
        const verifiedEmail = req.bcAuth?.email?.toLowerCase() ?? null;
        if (!verifiedEmail) return reply.code(401).send({ error: "auth_required" });
        if (verifiedEmail !== inv.email.toLowerCase()) {
          return reply.code(403).send({ error: "email_mismatch" });
        }
      }

      const result = await withOrgScope(inv.org_id, async (client) => {
        // Find or create the user_account row.
        const { rows: existing } = await client.query<{ id: string; full_name: string | null }>(
          "SELECT id, full_name FROM core.user_account WHERE org_id = $1 AND email = $2",
          [inv.org_id, inv.email],
        );
        let userId: string;
        if (existing.length > 0) {
          userId = existing[0]!.id;
          if (parsed.data.full_name && !existing[0]!.full_name) {
            await client.query(
              "UPDATE core.user_account SET full_name = $2, updated_at = now() WHERE id = $1",
              [userId, parsed.data.full_name],
            );
          }
        } else {
          const { rows: created } = await client.query<{ id: string }>(
            `INSERT INTO core.user_account (org_id, email, full_name, is_active)
             VALUES ($1, $2, $3, true)
             RETURNING id`,
            [inv.org_id, inv.email, parsed.data.full_name ?? null],
          );
          userId = created[0]!.id;
        }

        // Upsert the role assignment. One row per (user, department, role).
        await client.query(
          `INSERT INTO core.role_assignment (user_id, department_id, role)
           VALUES ($1, $2, $3::core.role_kind)
           ON CONFLICT DO NOTHING`,
          [userId, inv.department_id, inv.role],
        );

        // Mark the invitation accepted.
        const { rows: closed } = await client.query<InvitationRow>(
          `UPDATE core.invitation
              SET status = 'accepted'::core.invitation_status,
                  accepted_at = now(),
                  updated_at = now()
            WHERE id = $1
          RETURNING ${INVITATION_COLUMNS}`,
          [inv.id],
        );
        const row = closed[0]!;
        await audit(
          {
            scope: { org_id: inv.org_id, department_id: inv.department_id, goal_id: null, role: "owner" },
            action: "invitation.accept",
            target_type: "invitation",
            target_id: row.id,
            metadata: { email: inv.email, user_id: userId, role: inv.role },
          },
          client,
        );

        const { rows: orgRows } = await client.query<{ slug: string; name: string }>(
          "SELECT slug, name FROM core.organization WHERE id = $1",
          [inv.org_id],
        );

        return {
          user_id: userId,
          org: orgRows[0] ?? null,
          role: inv.role as InvitableRole,
          department_id: inv.department_id,
          accepted_at: row.accepted_at,
        };
      });

      return reply.send(result);
    },
  );
}
