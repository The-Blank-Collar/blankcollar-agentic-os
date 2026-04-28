# Real Paperclip — run natively on your Mac

The upstream **paperclipai** package
(https://github.com/paperclipai/paperclip) is the primary command centre
at **http://localhost:3100**.

**It runs natively on your Mac, not in Docker.** One make target.

## How to start it

```bash
make paperclip
```

That runs `npx paperclipai@latest run` from your home folder. Open
**http://localhost:3100**. Loads straight into the dashboard. Ctrl+C in
that terminal to stop it. State lives in `~/.paperclip/` and survives
restarts.

## Why not Docker

We tried, hard. Six different attempts:

1. `PAPERCLIP_BIND=0.0.0.0` env var → ignored (`--yes` quickstart locks loopback)
2. `--bind lan` flag → enables auth wall before the user can do anything
3. `sed`-patching `config.json` → paperclipai re-reads at startup, reverts
4. Node-based JSON patch on `bind`/`host` keys → same problem
5. `network_mode: host` → Mac Docker Desktop doesn't actually share host loopback (Linux-only)
6. `socat` reverse proxy inside the container → never went healthy in the time budget

The root cause: paperclipai's `local_trusted` deployment mode hard-locks
`127.0.0.1` binding, and Docker Desktop on macOS doesn't expose container
loopback to the host. Native install bypasses all of it. Done in 30 seconds.

When this codebase ships to Hostinger (Linux VPS), the situation is different —
Linux Docker DOES expose container loopback via `network_mode: host`, so
deploying paperclipai there is feasible. We'll cross that bridge in
`docs/HOSTINGER_DEPLOY.md` when we get to it.

## How native paperclipai talks to the Docker stack

Native paperclipai on your Mac and our Dockerized services share `localhost`:

| Service | URL paperclipai uses |
|---|---|
| Hermes (HTTP webhook agent) | `http://localhost:8001/run` · `/healthz` |
| OpenClaw (HTTP webhook agent) | `http://localhost:8002/run` · `/healthz` |
| gbrain (memory) | `http://localhost:8003/remember` · `/recall` |

Inside paperclipai's UI, register Hermes and OpenClaw as **HTTP webhook
agents** pointing at those URLs. The agents keep running in Docker.

## `make doctor` and native paperclipai

`make doctor` probes `:3100` as an **optional** check:
- If native paperclipai is running → green check
- If not → yellow info line with the command to start it

So `make doctor` always returns success regardless of whether you have
paperclipai running on your host.

## Files retained

`apps/paperclip-real/` (Dockerfile + entrypoint) is **kept on disk but
unreferenced**. If upstream paperclipai ever ships a `bind: 0.0.0.0` config
option, we can revive the Docker path. Until then it's dead code we just
don't delete.
