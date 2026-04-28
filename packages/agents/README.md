# Agents Registry

Shared types, contracts, and helpers used by every agent adapter under `apps/<agent>/`.

## Status

Empty placeholder. Populated alongside the first real adapter in Phase 3.

## What lives here

- `contract.ts` — TypeScript types for the adapter HTTP contract (mirrors `docs/API.md`)
- `client.ts` — typed client used by Paperclip to call adapters
- `health.ts` — shared `/healthz` shape
- `budget.ts` — soft/hard cost-cap helpers
- `streaming.ts` — wire format for run telemetry events

Adapters import from this package so the contract is enforced by the type system, not by hope.

## See also

- [`docs/AGENTS.md`](../../docs/AGENTS.md) — adapter contract & lifecycle
- [`docs/API.md`](../../docs/API.md#agent-adapter-contract-l3) — HTTP shapes
