# Website — `blankcollar.ai` console

Swiss-editorial React surface for the Agentic OS. Vite + React 18 + TypeScript;
nginx serves the built dist in Docker. Replaces Paperclip's htmx UI as the
front door at `:3000` (Paperclip's REST API moved to `:3001`).

## Status

**Sprint 1 (this slice)** — Vite scaffold, tokens + design vocabulary,
sidebar/topbar shell, Dashboard rendered against fixtures, Tweaks panel
(theme · density · role · surface), Mobile placeholder behind the surface
toggle. No backend coupling yet — the screens that wire to the live API
arrive in S2 onward.

## Local dev

```bash
cd apps/website
npm install
npm run dev          # http://localhost:5173
```

Or via the full stack:

```bash
make up              # http://localhost:3000  ← website
                     # http://localhost:3001  ← paperclip API
```

## Layout

```
apps/website/
├── index.html               # Vite entry (Geist + Instrument Serif preconnects)
├── vite.config.ts
├── tsconfig.json
├── Dockerfile               # node:22 build → nginx:alpine runtime
└── src/
    ├── main.tsx             # ReactDOM root
    ├── App.tsx              # routing, tweaks, surface toggle
    ├── icons.tsx            # I, ChannelMark, Sigil
    ├── styles/
    │   └── tokens.css       # Swiss editorial monochrome (dark first)
    ├── shell/
    │   ├── Sidebar.tsx
    │   └── Topbar.tsx
    ├── pages/
    │   ├── Dashboard.tsx    # fully ported S1
    │   ├── MobilePlaceholder.tsx
    │   └── (other pages — stub in S1, wired in S2–S5)
    ├── lib/
    │   └── tweaks.tsx       # floating panel + radios/toggles
    └── data/
        └── fixtures.ts      # design fixtures (retired one screen at a time)
```

## What's deferred

- Live API wiring (S2): `/goals`, `/runs`, `/audit`, `/agents`
- Brain constellation (S3) + KRs (`ops.key_result` migration)
- Kanban + Settings + Inbox (S4)
- ⌘K palette · Print mode · htmx removal · doctor.sh probe (S5)
- Auth UI · governance writes · Channels OAuth · voice · mobile · E2B
