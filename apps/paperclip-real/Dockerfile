# =============================================================================
# Paperclip (real) — wraps the upstream paperclipai package from npm.
#
# We let paperclipai bind to its preferred 127.0.0.1:3100 inside the
# container (it refuses anything else without auth) and put a `socat`
# TCP forwarder in front of it on 0.0.0.0:3100 so Docker's host
# port-forward actually works. See entrypoint.sh.
# =============================================================================

FROM node:22-bookworm-slim

# Tools paperclipai may need at install/runtime + socat for the forwarder
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git python3 socat \
 && rm -rf /var/lib/apt/lists/*

ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    PAPERCLIP_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1

USER node
WORKDIR /home/node

# Pre-create the .paperclip dir AS node BEFORE Docker mounts the volume here
# (otherwise the volume comes up root-owned and paperclipai can't write).
RUN mkdir -p /home/node/.paperclip

# Pre-warm the npx cache so first-run is faster.
RUN mkdir -p /home/node/.npm-cache \
 && NPM_CONFIG_CACHE=/home/node/.npm-cache npx --yes paperclipai@latest --version || true

COPY --chown=node:node entrypoint.sh /home/node/entrypoint.sh
RUN chmod +x /home/node/entrypoint.sh

EXPOSE 3100

CMD ["/home/node/entrypoint.sh"]
