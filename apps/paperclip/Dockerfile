# =============================================================================
# Paperclip — orchestrator + dashboard
# Multi-stage Node 22 image. Runtime ships only production node_modules + dist.
# =============================================================================

FROM node:22-bookworm-slim AS deps

ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /build
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# -----------------------------------------------------------------------------

FROM node:22-bookworm-slim AS build

ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm run build

# -----------------------------------------------------------------------------

FROM node:22-bookworm-slim AS prod-deps

ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /build
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# -----------------------------------------------------------------------------

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PAPERCLIP_INTERNAL_PORT=80 \
    NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

WORKDIR /app

# Non-root.
RUN groupadd --system paperclip && useradd --system --gid paperclip --home /app paperclip

COPY --from=prod-deps /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist
COPY package.json ./

USER paperclip
EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --retries=6 --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:80/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" \
  || exit 1

CMD ["node", "dist/index.js"]
