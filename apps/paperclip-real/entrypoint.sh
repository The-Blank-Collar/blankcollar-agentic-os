#!/bin/sh
# Idempotent entrypoint:
#   1. Onboard once if no config exists (paperclipai's quickstart, loopback).
#   2. Start socat on 0.0.0.0:3101 forwarding to paperclipai's 127.0.0.1:3100.
#      This is the bridge between Docker's port-forward (host:3100 →
#      container:3101) and paperclipai's hard-coded loopback bind.
#   3. Exec paperclipai run.
set -eu

CONFIG_DIR="${HOME}/.paperclip/instances/default"
CONFIG_FILE="${CONFIG_DIR}/config.json"
PAPERCLIP_PORT=3100
SOCAT_PORT=3101

# Sanity: confirm we can write where paperclipai stores state.
if ! mkdir -p "${HOME}/.paperclip" 2>/dev/null \
   || ! touch "${HOME}/.paperclip/.write-probe" 2>/dev/null; then
  echo "[paperclip][FATAL] cannot write to ${HOME}/.paperclip — volume not writable by uid $(id -u)." >&2
  echo "[paperclip][FATAL] recover: docker compose stop paperclip-real && docker compose rm -f paperclip-real && docker volume rm bc_paperclip_real_data && make bootstrap" >&2
  exit 78
fi
rm -f "${HOME}/.paperclip/.write-probe"

if [ ! -f "${CONFIG_FILE}" ]; then
  echo "[paperclip] no config — running onboard with quickstart defaults"
  npx --yes paperclipai@latest onboard --yes
else
  echo "[paperclip] reusing existing config at ${CONFIG_FILE}"
fi

# Start socat in the background BEFORE paperclipai. Docker's healthcheck
# probes paperclipai directly on 127.0.0.1:3100, so socat doesn't have to
# be ready first — but we want it up early anyway.
echo "[paperclip] starting socat forwarder: 0.0.0.0:${SOCAT_PORT} -> 127.0.0.1:${PAPERCLIP_PORT}"
socat TCP-LISTEN:${SOCAT_PORT},fork,reuseaddr TCP:127.0.0.1:${PAPERCLIP_PORT} &
SOCAT_PID=$!

# Cleanly tear down socat when paperclipai exits.
trap "kill ${SOCAT_PID} 2>/dev/null || true" EXIT INT TERM

export PAPERCLIP_TELEMETRY_DISABLED=1
echo "[paperclip] starting paperclipai (binds 127.0.0.1:${PAPERCLIP_PORT})"
exec npx --yes paperclipai@latest run
