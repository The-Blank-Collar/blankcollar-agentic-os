# Real Paperclip — run natively on your Mac

The upstream **paperclipai** package
(https://github.com/paperclipai/paperclip) is the primary command centre.
**Don't run it in Docker.** Run it directly on your Mac.

## Why not Docker

Paperclip's `--yes` quickstart hard-locks `deployment: local_trusted` mode,
which forces a `127.0.0.1` (loopback) bind regardless of `--bind` flags,
`PAPERCLIP_BIND` env vars, or post-onboard config patches. Inside a Docker
container that means Docker's host port-forward can never reach it. We
spent hours fighting this; it's the upstream's design choice. Run it
natively — it works in 30 seconds.

## How to run it

In **any terminal tab on your Mac** (one-time setup):

```bash
npx paperclipai@latest onboard --yes
```

That creates `~/.paperclip/instances/default/` with embedded Postgres + secrets.

Then any time you want the UI:

```bash
npx paperclipai@latest run
```

Open **http://localhost:3100**. That's it.

To stop it: `Ctrl+C` in that terminal.

## How it talks to the rest of our stack

Native paperclipai on your Mac and our Dockerized services share `localhost`:

| What it can reach | URL |
|---|---|
| Hermes (HTTP webhook agent) | `http://localhost:8001/run` · `/healthz` |
| OpenClaw (HTTP webhook agent) | `http://localhost:8002/run` · `/healthz` |
| gbrain (memory layer) | `http://localhost:8003/remember` · `/recall` |

In paperclipai's UI, register Hermes and OpenClaw as **HTTP webhook agents**
pointing at those host URLs. The agents will keep running in Docker; only
paperclipai itself is on the host.

## Where everything lives

| Service | Where | URL |
|---|---|---|
| **Real Paperclip** (command centre) | **Native on your Mac** (`npx paperclipai run`) | http://localhost:3100 |
| Custom orchestrator (legacy / integrations) | Docker | http://localhost:3000 |
| Hermes | Docker | http://localhost:8001 |
| OpenClaw | Docker | http://localhost:8002 |
| gbrain | Docker | http://localhost:8003 |
| Postgres | Docker | `localhost:5432` |
| Qdrant | Docker | http://localhost:6333 |

## Optional: keep the Docker scaffolding around

The `apps/paperclip-real/` folder still has a Dockerfile + entrypoint left
over from our (failed) dockerization attempts. They're not referenced by
`docker-compose.yml` anymore. Safe to ignore. We may revisit if upstream
paperclipai ever adds a "bind to 0.0.0.0" config option.

## doctor.sh

`make doctor` will probe `:3100` and tell you:
- ✅ if native paperclipai is running
- ⚠️ if it isn't (with the command to start it) — but won't fail

So `make doctor` returns success whether or not paperclipai is running on
your host.
