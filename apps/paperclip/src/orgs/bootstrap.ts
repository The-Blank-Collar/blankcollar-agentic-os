/**
 * Per-user org bootstrap (Phase 8.1).
 *
 * Called when a verified Supabase user signs in for the first time and
 * has no `core.user_account` row yet. Creates everything they need to
 * land on a working dashboard:
 *
 *   - core.organization (slug derived from email or random)
 *   - core.user_account (linked to the new org)
 *   - core.role_assignment (owner)
 *   - ops.agent x2 (Hermes, OpenClaw — so the worker has someone to dispatch to)
 *   - ops.goal x1 example (kind=ephemeral, status=draft, marked metadata.example=true)
 *
 * All in a single withSystemScope transaction so a partial failure
 * rolls everything back. Idempotent: if the email already has an
 * account, returns the existing scope unchanged.
 *
 * The starter pack (Phase 8.5) is intentionally tiny — the onboarding
 * wizard creates the personalised routine drafts + voice doc on top.
 */

import { withSystemScope } from "../db.js";
import { send as sendMail } from "../mail/index.js";
import { welcome as welcomeTemplate } from "../mail/templates.js";
import type { Scope } from "../schemas.js";

const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "auth", "billing", "demo", "settings", "system", "www",
]);

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "studio";
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export type BootstrapInput = {
  email: string;
  full_name?: string | null;
  /** Optional preferred org name; falls back to "{name}'s studio". */
  org_name?: string | null;
};

export type BootstrapResult = {
  user_id: string;
  org_id: string;
  org_slug: string;
  org_name: string;
  /** True if everything was just created; false if we resolved an existing user. */
  created: boolean;
};

export async function bootstrapUserOrg(input: BootstrapInput): Promise<BootstrapResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("invalid_email");

  return withSystemScope(async (client) => {
    // Already exists? Resolve to the existing scope.
    const { rows: existingUser } = await client.query<{
      id: string;
      org_id: string;
      org_slug: string;
      org_name: string | null;
    }>(
      `SELECT u.id, u.org_id, o.slug AS org_slug, o.name AS org_name
         FROM core.user_account u
         JOIN core.organization o ON o.id = u.org_id
        WHERE u.email = $1
        LIMIT 1`,
      [email],
    );
    if (existingUser[0]) {
      const u = existingUser[0];
      return {
        user_id: u.id,
        org_id: u.org_id,
        org_slug: u.org_slug,
        org_name: u.org_name ?? "Studio",
        created: false,
      };
    }

    const displayName = (input.full_name ?? "").trim() || email.split("@")[0]!;
    const orgName = (input.org_name ?? "").trim() || `${displayName}'s studio`;

    // Find an unused slug.
    const baseSlug = slugify(displayName);
    let slug = RESERVED_SLUGS.has(baseSlug) ? `${baseSlug}-${randomSuffix()}` : baseSlug;
    for (let i = 0; i < 5; i++) {
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM core.organization WHERE slug = $1",
        [slug],
      );
      if (rows.length === 0) break;
      slug = `${baseSlug}-${randomSuffix()}`;
    }

    const { rows: orgRows } = await client.query<{ id: string }>(
      `INSERT INTO core.organization (slug, name)
       VALUES ($1, $2)
       RETURNING id`,
      [slug, orgName],
    );
    const orgId = orgRows[0]!.id;

    const { rows: userRows } = await client.query<{ id: string }>(
      `INSERT INTO core.user_account (org_id, email, display_name, full_name, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id`,
      [orgId, email, displayName, input.full_name ?? null],
    );
    const userId = userRows[0]!.id;

    await client.query(
      `INSERT INTO core.role_assignment (user_id, role)
       VALUES ($1, 'owner'::core.role_kind)
       ON CONFLICT DO NOTHING`,
      [userId],
    );

    // -- starter pack (Phase 8.5) ---------------------------------------
    // Two agents so the worker has a target. Both are deterministic:
    // Hermes = prose, OpenClaw = web/tools. Same kinds the docker stack ships.
    const seedAgents: { kind: string; name: string; config: Record<string, unknown> }[] = [
      { kind: "hermes", name: "Hermes", config: { role: "general-purpose reasoning" } },
      { kind: "openclaw", name: "OpenClaw", config: { role: "web + tool execution" } },
    ];
    for (const a of seedAgents) {
      await client.query(
        `INSERT INTO ops.agent (org_id, kind, name, config, is_active)
         VALUES ($1, $2, $3, $4::jsonb, true)
         ON CONFLICT DO NOTHING`,
        [orgId, a.kind, a.name, JSON.stringify(a.config)],
      );
    }

    // One example goal so the dashboard isn't empty on day one. Marked
    // example=true so the operator knows it's safe to delete.
    await client.query(
      `INSERT INTO ops.goal (org_id, title, description, kind, status, metadata)
       VALUES ($1, $2, $3, 'ephemeral'::ops.goal_kind, 'draft'::ops.goal_status, $4::jsonb)`,
      [
        orgId,
        "Welcome — try capturing a goal",
        "This is an example. Delete it any time. Try the capture composer (⌘K → New goal) " +
          "with a real intent like 'Remind me to call Mira on Friday' or 'Every Monday at 9, " +
          "generate the weekly digest' — the classifier will figure out the kind, schedule, and target.",
        JSON.stringify({ example: true, source: "bootstrap" }),
      ],
    );

    // Welcome email — best-effort, never blocks bootstrap.
    void sendMail({
      to: email,
      ...welcomeTemplate({ email, full_name: input.full_name ?? null, org_name: orgName }),
    }).catch(() => {
      /* logged inside the provider; bootstrap stays clean */
    });

    return {
      user_id: userId,
      org_id: orgId,
      org_slug: slug,
      org_name: orgName,
      created: true,
    };
  });
}

export function bootstrapToScope(result: BootstrapResult): Scope {
  return {
    org_id: result.org_id,
    department_id: null,
    goal_id: null,
    role: "owner",
  };
}
