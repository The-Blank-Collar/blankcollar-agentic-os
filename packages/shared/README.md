# `@blankcollar/shared`

Wire-shape types + a tiny typed `fetch` client for the Paperclip REST API.
Consumed by `apps/website/` (the Swiss-editorial console). Server-side
Paperclip uses Zod as the source-of-truth — the types here mirror those
shapes hand-written, so the package ships zero runtime deps.

## What's in here

- `src/types.ts` — `Goal`, `GoalWithDetail`, `KeyResult`, `Run`, `AuditEntry`,
  `AgentState`, request/response wrappers. All hand-mirrored from
  `apps/paperclip/src/{schemas,routes}/*.ts`.
- `src/api-client.ts` — `createApiClient({ baseUrl, orgSlug })` factory.
  Returns an object with `listGoals`, `getGoal`, `patchGoal`, `dispatchGoal`,
  `dispatchAllForGoal`, `listRuns`, `cancelRun`, `listAudit`, `listAgents`,
  `getAgentState`. Errors throw `ApiCallError`.

## Why hand-mirrored, not codegen

~10 endpoints, schemas already locked. A codegen pass would mostly
duplicate what's already typed in Paperclip; the hand-mirror trades a
deliberate `git diff` for tooling overhead. When the server adds a field,
mirror it here in the same commit.

## Used by

- `apps/website/src/lib/api.ts` — wraps the factory, reads
  `VITE_PAPERCLIP_URL` + `VITE_DEFAULT_ORG_SLUG`, exports a singleton.
