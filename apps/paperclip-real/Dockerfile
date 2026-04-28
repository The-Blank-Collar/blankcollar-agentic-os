# =============================================================================
# Paperclip (real) — wraps the upstream paperclipai package from npm.
#
# Strategy: paperclipai binds 127.0.0.1:3100 inside the container (its
# `local_trusted` mode forces loopback). We run a `socat` forwarder on
# 0.0.0.0:3101 → 127.0.0.1:3100 alongside it. docker-compose.yml maps
# host:3100 → container:3101, so the host's curl reaches socat → paperclipai.
# =============================================================================

FROM node:22-bookworm-slim

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

# Pre-create the .paperclip dir AS node BEFORE Docker mounts the volume here.
# Otherwise the volume comes up root-owned and paperclipai can't write to it.
RUN mkdir -p /home/node/.paperclip

# Pre-warm the npx cache so first-run is faster.
RUN mkdir -p /home/node/.npm-cache \
 && NPM_CONFIG_CACHE=/home/node/.npm-cache npx --yes paperclipai@latest --version || true

COPY --chown=node:node entrypoint.sh /home/node/entrypoint.sh
RUN chmod +x /home/node/entrypoint.sh

# socat listens on this; paperclipai listens on 3100 (loopback).
EXPOSE 3101

CMD ["/home/node/entrypoint.sh"]
