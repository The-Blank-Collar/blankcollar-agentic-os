#!/bin/sh
# Idempotent entrypoint: onboard once, then run forever.
set -eu

CONFIG_DIR="${HOME}/.paperclip/instances/default"
CONFIG_FILE="${CONFIG_DIR}/config.json"

# Sanity: confirm we can write where we're supposed to.
if ! mkdir -p "${HOME}/.paperclip" 2>/dev/null \
   || ! touch "${HOME}/.paperclip/.write-probe" 2>/dev/null; then
  echo "[paperclip][FATAL] cannot write to ${HOME}/.paperclip — volume is not writable by uid $(id -u)." >&2
  echo "[paperclip][FATAL] this is the 'restart-loop on first boot' bug. Wipe the volume and rebuild:" >&2
  echo "[paperclip][FATAL]   docker compose stop paperclip-real && docker compose rm -f paperclip-real && docker volume rm bc_paperclip_real_data && make bootstrap" >&2
  exit 78
fi
rm -f "${HOME}/.paperclip/.write-probe"

if [ ! -f "${CONFIG_FILE}" ]; then
  echo "[paperclip] no config found — running onboard with quickstart defaults"
  npx --yes paperclipai@latest onboard --yes
else
  echo "[paperclip] reusing existing config at ${CONFIG_FILE}"
fi

# Bind to all interfaces so Docker port-forward works (paperclip defaults to 127.0.0.1).
# Their config.json controls bind; we override via env where supported.
export PAPERCLIP_BIND="${PAPERCLIP_BIND:-0.0.0.0}"
export PAPERCLIP_TELEMETRY_DISABLED=1

echo "[paperclip] starting server"
exec npx --yes paperclipai@latest run
