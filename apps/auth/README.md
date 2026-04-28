# Auth

Supabase-backed authentication and role mapping. Phase 6 deliverable.

## Status

Empty placeholder. Reserves the slot for the JWT-validating edge layer that will sit in front of Paperclip.

## What lands here

- `verifyJWT` middleware (validates Supabase tokens, attaches `Scope` to the request)
- Role-mapping job: copies Supabase user metadata into `core.role_assignment`
- Invitation flow: invite by email, role pre-assigned, link expires in 7 days
- Org creation flow (server-side, never client-side)
- Service-role-key guard: detects accidental browser-bound usage at build time

## Env vars (from `.env.example`)

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`           — safe to ship to browser
- `SUPABASE_SERVICE_ROLE_KEY`   — **server-only**, never expose

## Hard rules

- Verify the JWT on **every** request. No "trusted internal" bypass.
- The service-role key never leaves this app.
- Role changes always write to `core.audit_log`.
- A user with no `role_assignment` rows for an org is treated as no access — never as a default.

## Non-goals

- We don't build our own password reset or magic-link UI. Supabase handles that.
- No social login bonanza. Phase 6 ships email + magic link. OAuth providers come post-launch.
