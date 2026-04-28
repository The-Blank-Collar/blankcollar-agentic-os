# =============================================================================
# Paperclip (real) — wraps the upstream paperclipai package from npm.
#
# Provides:
#   - First-run `paperclipai onboard --yes` if no config exists yet
#   - `paperclipai run` afterwards
#   - Persistent state via a volume mounted at /home/node/.paperclip
# =============================================================================

FROM node:22-bookworm-slim

# Tools paperclipai may need at install/runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git python3 \
 && rm -rf /var/lib/apt/lists/*

ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    PAPERCLIP_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1

USER node
WORKDIR /home/node

# Create the .paperclip dir AS the node user BEFORE Docker mounts the volume
# at this path. When Docker creates a volume on first run, it copies the
# directory's existing ownership/permissions onto the volume — so creating
# it here as node:node prevents the "EACCES: permission denied" loop the
# container falls into otherwise.
RUN mkdir -p /home/node/.paperclip

# Pre-warm the npx cache so first-run is faster.
RUN mkdir -p /home/node/.npm-cache \
 && NPM_CONFIG_CACHE=/home/node/.npm-cache npx --yes paperclipai@latest --version || true

COPY --chown=node:node entrypoint.sh /home/node/entrypoint.sh
RUN chmod +x /home/node/entrypoint.sh

EXPOSE 3100

CMD ["/home/node/entrypoint.sh"]
