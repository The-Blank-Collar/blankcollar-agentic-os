/**
 * Supabase JWT verification + scope derivation.
 *
 * Two verification paths, auto-detected per token:
 *
 *   1. Asymmetric (modern Supabase default — ES256 / RS256)
 *      Uses the project's JWKS endpoint at
 *      `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`. The remote keyset
 *      is cached and refreshed automatically by jose.
 *
 *   2. HS256 (legacy Supabase / self-managed projects)
 *      Falls back to the shared `SUPABASE_JWT_SECRET` when JWKS is
 *      unavailable or the token is HS256-signed. Kept for installs
 *      that haven't migrated to asymmetric signing.
 *
 * v0 behaviour:
 *   - Neither SUPABASE_URL nor SUPABASE_JWT_SECRET set → no-op,
 *     every request stays stubbed to the demo org's owner.
 *   - Either set:
 *       * `Authorization: Bearer <jwt>` present → verify; on success,
 *         attach a derived Scope to `request.bcScope`.
 *       * Header absent → fall through (still stub) unless
 *         PAPERCLIP_AUTH_ENFORCE=true, in which case respond 401.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";

import { config } from "./config.js";
import { query } from "./db.js";
import { bootstrapToScope, bootstrapUserOrg } from "./orgs/bootstrap.js";
import type { RoleKind, Scope } from "./schemas.js";

declare module "fastify" {
  interface FastifyRequest {
    bcScope?: Scope;
    bcAuth?: { sub: string; email: string | null; verified: true };
  }
}

type SupabaseClaims = {
  sub: string;
  email?: string | null;
  aud?: string;
  exp?: number;
  user_metadata?: { full_name?: string; name?: string } | null;
};

let secretKey: Uint8Array | undefined;

function getSecret(): Uint8Array | undefined {
  if (!config.supabaseJwtSecret) return undefined;
  if (!secretKey) {
    secretKey = new TextEncoder().encode(config.supabaseJwtSecret);
  }
  return secretKey;
}

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks(): ReturnType<typeof createRemoteJWKSet> | undefined {
  if (!config.supabaseProjectUrl) return undefined;
  if (!cachedJwks) {
    try {
      // Strip any trailing slash before composing the path.
      const base = config.supabaseProjectUrl.replace(/\/+$/, "");
      const url = new URL(`${base}/auth/v1/.well-known/jwks.json`);
      cachedJwks = createRemoteJWKSet(url, {
        // Tolerate brief unavailability — jose caches the JWKS in-memory.
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60_000,
      });
    } catch {
      cachedJwks = undefined;
    }
  }
  return cachedJwks;
}

/**
 * Detect available verifiers without a token.
 * Used by the preHandler to know whether auth should engage at all.
 */
export function authConfigured(): boolean {
  return Boolean(config.supabaseJwtSecret || config.supabaseProjectUrl);
}

export async function verifyBearer(token: string): Promise<SupabaseClaims> {
  // Try the modern JWKS path first. jose will pick the right algorithm
  // (ES256 / RS256 / etc) from the token header automatically.
  const jwks = getJwks();
  if (jwks) {
    try {
      const { payload } = await jwtVerify(token, jwks);
      return payload as SupabaseClaims;
    } catch {
      // Asymmetric verification failed — could be a legacy HS256 token,
      // or a real signature mismatch. Fall through to HS256 attempt; if
      // both fail the route handler 401s.
    }
  }
  const key = getSecret();
  if (!key) {
    throw new Error(
      "JWT verification unavailable — set SUPABASE_URL (modern, asymmetric) " +
        "or SUPABASE_JWT_SECRET (legacy HS256) in .env.",
    );
  }
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
  return payload as SupabaseClaims;
}

/**
 * Resolve a verified Supabase user into a Scope.
 *
 * Strategy: look up `core.user_account` by email. If found, use the highest-
 * privilege role assignment for that user as the scope role. If not found,
 * return undefined — the caller decides whether to 401 or fall back.
 */
export async function scopeForVerifiedUser(
  email: string,
): Promise<Scope | undefined> {
  type Row = {
    user_id: string;
    org_id: string;
    department_id: string | null;
    role: RoleKind;
  };
  const { rows } = await query<Row>(
    `
    SELECT u.id AS user_id, u.org_id, ra.department_id, ra.role
    FROM core.user_account u
    LEFT JOIN core.role_assignment ra ON ra.user_id = u.id
    WHERE u.email = $1 AND u.is_active = true
    ORDER BY CASE ra.role
      WHEN 'owner' THEN 0
      WHEN 'department_lead' THEN 1
      WHEN 'auditor' THEN 2
      WHEN 'team_member' THEN 3
      WHEN 'agent' THEN 4
      ELSE 9
    END
    LIMIT 1
    `,
    [email],
  );
  if (rows.length === 0) return undefined;
  const r = rows[0]!;
  return {
    org_id: r.org_id,
    department_id: r.department_id,
    goal_id: null,
    role: r.role ?? "team_member",
  };
}

/**
 * Fastify preHandler. Mounts on /api/* only — UI routes do their own thing.
 */
export async function authPreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Only intercept API routes.
  if (!request.url.startsWith("/api/")) return;

  // CORS preflight — the browser sends OPTIONS without a Bearer header
  // before any cross-origin POST/PATCH/DELETE. Let it through to the CORS
  // plugin's handler; blocking it 401s the preflight and the real request
  // never fires.
  if (request.method === "OPTIONS") return;

  // Public endpoints — never auth-gated regardless of mode:
  //   /api/health           — Docker healthcheck (must be reachable)
  //   /api/webhooks/*       — Stripe + Telegram + capture (own signature
  //                           verification at the route level)
  //   /api/invitations/by-token/* — recipient may not have an account yet
  if (
    request.url === "/api/health" ||
    request.url.startsWith("/api/health?") ||
    request.url.startsWith("/api/webhooks/") ||
    request.url.startsWith("/api/invitations/by-token/")
  ) {
    return;
  }

  // Auth is OFF (no Supabase configured at all) → no-op.
  if (!authConfigured()) return;

  const header = request.headers.authorization;
  const bearer = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";

  if (!bearer) {
    if (config.authEnforce) {
      return reply.code(401).send({ error: "auth_required" });
    }
    return; // soft mode — fall through to stub scope
  }

  let claims: SupabaseClaims;
  try {
    claims = await verifyBearer(bearer);
  } catch {
    return reply.code(401).send({ error: "invalid_token" });
  }
  const email = (claims.email ?? "").toLowerCase();
  request.bcAuth = { sub: claims.sub, email: email || null, verified: true };

  if (email) {
    const scope = await scopeForVerifiedUser(email);
    if (scope) {
      request.bcScope = scope;
      return;
    }
    // No account yet. In auto-bootstrap mode (the default for hosted
    // SaaS) we provision the user's own org on the spot — owner role,
    // two seed agents, and a welcome goal. The next request lands on
    // a working dashboard with no further setup.
    if (config.autoBootstrap) {
      try {
        const fullName =
          claims.user_metadata?.full_name?.trim() ||
          claims.user_metadata?.name?.trim() ||
          null;
        const result = await bootstrapUserOrg({ email, full_name: fullName });
        request.bcScope = bootstrapToScope(result);
        return;
      } catch (err) {
        request.log.error({ err, email }, "auto-bootstrap failed");
        if (config.authEnforce) {
          return reply.code(500).send({ error: "bootstrap_failed" });
        }
        // Soft mode — fall through to stub scope.
      }
    }
  }
  // Token is valid but the user has no provisioned account/role.
  if (config.authEnforce) {
    return reply.code(403).send({ error: "no_account" });
  }
  // Soft mode — fall through to stub scope.
}
