#!/bin/sh
# Idempotent entrypoint:
#   1. Onboard once if no config exists (uses paperclipai's quickstart defaults
#      → loopback bind, no auth).
#   2. Make sure paperclipai listens on an internal port (3101).
#   3. Run a `socat` TCP forwarder from 0.0.0.0:3100 → 127.0.0.1:3101 so the
#      Docker host port-forward actually reaches paperclipai. paperclipai's
#      quickstart hard-locks loopback; we bypass it cleanly here without
#      switching to authenticated LAN mode.
#   4. Exec paperclipai run.
set -eu

CONFIG_DIR="${HOME}/.paperclip/instances/default"
CONFIG_FILE="${CONFIG_DIR}/config.json"
INTERNAL_PORT=3101
EXTERNAL_PORT=3100

# Sanity: confirm we can write where we're supposed to.
if ! mkdir -p "${HOME}/.paperclip" 2>/dev/null \
   || ! touch "${HOME}/.paperclip/.write-probe" 2>/dev/null; then
  echo "[paperclip][FATAL] cannot write to ${HOME}/.paperclip — volume is not writable by uid $(id -u)." >&2
  exit 78
fi
rm -f "${HOME}/.paperclip/.write-probe"

if [ ! -f "${CONFIG_FILE}" ]; then
  echo "[paperclip] no config found — running onboard with quickstart defaults"
  npx --yes paperclipai@latest onboard --yes
else
  echo "[paperclip] reusing existing config at ${CONFIG_FILE}"
fi

# Paperclip wrote port 3100 by default — move it to INTERNAL_PORT so socat
# can claim 3100 on 0.0.0.0 without colliding.
node -e "
  const fs = require('fs');
  const p = '${CONFIG_FILE}';
  if (!fs.existsSync(p)) process.exit(0);
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  let changed = 0;
  (function walk(o){
    if (!o || typeof o !== 'object') return;
    if ('port' in o && o.port === ${EXTERNAL_PORT}) { o.port = ${INTERNAL_PORT}; changed++; }
    for (const k in o) walk(o[k]);
  })(c);
  if (changed) {
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
    console.log('[paperclip] moved internal port ${EXTERNAL_PORT} → ${INTERNAL_PORT} (' + changed + ' field(s))');
  }
"

echo "[paperclip] starting socat forwarder: 0.0.0.0:${EXTERNAL_PORT} -> 127.0.0.1:${INTERNAL_PORT}"
socat TCP-LISTEN:${EXTERNAL_PORT},fork,reuseaddr TCP:127.0.0.1:${INTERNAL_PORT} &
SOCAT_PID=$!

# If paperclipai exits, kill socat too so the container restarts cleanly.
trap "kill ${SOCAT_PID} 2>/dev/null || true" EXIT INT TERM

export PAPERCLIP_TELEMETRY_DISABLED=1
echo "[paperclip] starting server (will bind 127.0.0.1:${INTERNAL_PORT})"
exec npx --yes paperclipai@latest run
