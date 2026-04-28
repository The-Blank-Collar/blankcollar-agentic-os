# =============================================================================
# Paperclip (real) — wraps the upstream paperclipai package from npm.
#
# Used with `network_mode: host` in docker-compose.yml so paperclipai's
# loopback-only bind reaches the host's localhost directly.
# =============================================================================

FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git python3 \
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

EXPOSE 3100

CMD ["/home/node/entrypoint.sh"]
