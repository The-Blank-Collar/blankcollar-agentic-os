# Auth — Supabase JWT scaffolding

The Supabase auth layer is **embedded inside Paperclip** rather than running
as a separate service. The actual implementation lives in:

- `apps/paperclip/src/auth.ts` — `verifyBearer()` + `authPreHandler` (Fastify hook)
- `apps/paperclip/src/scope.ts` — `resolveCallerScope(req)` honours JWT-derived scope
- `apps/paperclip/src/config.ts` — Supabase config

This folder remains as a **slot for future auth helpers** (admin bootstrap,
invitation flow, role re-mapping CLI, etc.) once Phase 6 needs them. Today
it's intentionally empty.

## How it works in v0

| `SUPABASE_JWT_SECRET` | `PAPERCLIP_AUTH_ENFORCE` | Behaviour |
|---|---|---|
| unset | any                | All callers → demo-org owner stub. (Today's default.) |
| set   | `false` (default)   | Verify token if present; fall back to stub if absent. |
| set   | `true`              | Require a valid JWT for every API call (401/403 otherwise). |

The verifier accepts HS256 tokens (Supabase's default). When a token verifies,
Paperclip looks up `core.user_account` by email and resolves the highest-
privilege role from `core.role_assignment` into the request scope.

## Setting it up

1. Create a Supabase project (free tier is fine).
2. Settings → API → copy **JWT Secret** into `SUPABASE_JWT_SECRET` in `.env`.
3. (Optional) copy **Project URL** into `SUPABASE_URL`.
4. Provision users by inserting into `core.user_account` with the email
   matching their Supabase email; add a `core.role_assignment` row.
5. Restart Paperclip — its startup log will say `auth=supabase`.
6. To enforce: set `PAPERCLIP_AUTH_ENFORCE=true` and restart.

## Phase 6 will add

- A `/login` UI route in Paperclip that hands off to Supabase Auth UI.
- A session cookie path so the dashboard (not just API clients) is
  authenticated.
- An admin tool to invite users by email and assign roles.
- Anti-CSRF for state-changing UI fragments.
