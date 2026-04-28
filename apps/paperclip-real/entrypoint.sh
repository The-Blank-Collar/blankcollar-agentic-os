#!/bin/sh
# Idempotent entrypoint: onboard once, then run forever.
set -eu

CONFIG_DIR="${HOME}/.paperclip/instances/default"
CONFIG_FILE="${CONFIG_DIR}/config.json"

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

exec npx --yes paperclipai@latest run
