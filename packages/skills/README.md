# Skills Catalog

The home of the L2 intelligence layer — see [`docs/SKILLS.md`](../../docs/SKILLS.md) for the spec.

## Status

Empty placeholder. First skills land in Phase 5.

## What lives here

```
packages/skills/
├── index.ts                    # registry (Phase 5+)
├── policy.table.yaml           # default (role, skill_id) policy
├── web/
│   ├── fetch.yaml + fetch.ts
│   └── search.yaml + search.ts
├── email/
│   ├── send.yaml + send.ts
│   └── draft.yaml + draft.ts
├── calendar/
│   └── create_event.yaml + create_event.ts
├── db/
│   ├── query_readonly.yaml + query_readonly.ts
│   └── query_write.yaml + query_write.ts
└── payments/
    └── charge.yaml + charge.ts
```

## How to add a skill (when Phase 5 lands)

1. Manifest YAML with id, inputs, outputs, audit template, default policy.
2. Implementation file alongside it.
3. Register in `index.ts`.
4. Add policy defaults in `policy.table.yaml`.
5. Test that exercises the happy path.

See `docs/SKILLS.md` for the full anatomy.
