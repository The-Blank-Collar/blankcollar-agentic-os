#!/bin/sh
# Idempotent entrypoint. Onboard once, then run forever.
#
# We rely on `network_mode: host` in docker-compose.yml — that means the
# container's 127.0.0.1 IS the host's 127.0.0.1, so paperclipai's hard-coded
# loopback bind on :3100 is exactly what we want. No socat, no port-patch,
# no `--bind lan` auth dance.
set -eu

CONFIG_DIR="${HOME}/.paperclip/instances/default"
CONFIG_FILE="${CONFIG_DIR}/config.json"

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

export PAPERCLIP_TELEMETRY_DISABLED=1
echo "[paperclip] starting server (loopback bind == host's localhost:3100 via network_mode:host)"
exec npx --yes paperclipai@latest run
