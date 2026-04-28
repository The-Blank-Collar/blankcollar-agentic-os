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
  echo "[paperclip] no config found — running onboard in LAN mode"
  # --bind lan tells paperclip to listen on the LAN interface (0.0.0.0
  # inside our container) instead of loopback-only. Required for Docker's
  # host port-forward to work. Switches paperclip to 'authenticated' mode
  # (API calls need a JWT — the UI handles login on first visit).
  npx --yes paperclipai@latest onboard --yes --bind lan
else
  echo "[paperclip] reusing existing config at ${CONFIG_FILE}"
fi

# Defensive patch: even with --bind lan, walk the config and replace any
# remaining loopback-only values. We use Node (already in the image) so
# the JSON parse/write is robust.
if [ -f "${CONFIG_FILE}" ]; then
  node -e "
    const fs = require('fs');
    const p = '${CONFIG_FILE}';
    const c = JSON.parse(fs.readFileSync(p, 'utf8'));
    let changed = 0;
    (function walk(o){
      if (!o || typeof o !== 'object') return;
      if ('bind' in o && (o.bind === 'loopback' || o.bind === '127.0.0.1')) { o.bind = 'lan'; changed++; }
      if ('host' in o && o.host === '127.0.0.1') { o.host = '0.0.0.0'; changed++; }
      if ('allowedHostnames' in o && Array.isArray(o.allowedHostnames) && o.allowedHostnames.length === 0) {
        o.allowedHostnames = ['*']; changed++;
      }
      for (const k in o) walk(o[k]);
    })(c);
    if (changed) {
      fs.writeFileSync(p, JSON.stringify(c, null, 2));
      console.log('[paperclip] config patched (' + changed + ' field(s) updated for non-loopback access)');
    } else {
      console.log('[paperclip] config already non-loopback; no patch needed');
    }
  "

  echo '[paperclip] effective bind/host/port:'
  grep -E '"(bind|host|port|allowedHostnames)"' "${CONFIG_FILE}" | sed 's/^/  /' || true
fi

export PAPERCLIP_TELEMETRY_DISABLED=1

echo "[paperclip] starting server"
exec npx --yes paperclipai@latest run
