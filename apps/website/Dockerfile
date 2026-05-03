# =============================================================================
# Website — blankcollar.ai console
# Multi-stage: Node 22 builds the SPA → nginx:alpine serves the static dist.
#
# IMPORTANT: build context is the repo ROOT (`.`), not apps/website. The
# Vite alias for `@blankcollar/shared` resolves to `../../packages/shared/src/`
# from `apps/website/vite.config.ts`, so we mirror the repo layout inside the
# image: `/repo/apps/website/...` + `/repo/packages/shared/...`. The compose
# build entry uses `context: .` and `dockerfile: apps/website/Dockerfile`.
# =============================================================================

FROM node:22-bookworm-slim AS deps

ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /repo/apps/website
COPY apps/website/package.json apps/website/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

# -----------------------------------------------------------------------------

FROM node:22-bookworm-slim AS build

ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /repo/apps/website
COPY --from=deps /repo/apps/website/node_modules ./node_modules

# Website source — kept under the same relative path as in the repo so the
# Vite alias `../../packages/shared/src/` continues to resolve.
COPY apps/website/package.json apps/website/tsconfig.json apps/website/vite.config.ts apps/website/index.html ./
COPY apps/website/src ./src

# Shared package — must land at `/repo/packages/shared` for the alias to work.
COPY packages/shared /repo/packages/shared

RUN npm run build

# -----------------------------------------------------------------------------

FROM nginx:1.27-alpine AS runtime

# SPA routing: rewrite anything that's not a real file to index.html.
RUN printf 'server {\n\
  listen 80 default_server;\n\
  listen [::]:80 default_server;\n\
  server_name _;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  add_header Cache-Control "no-store" always;\n\
  location / {\n\
    try_files $uri /index.html;\n\
  }\n\
  location /healthz {\n\
    access_log off;\n\
    return 200 "ok\\n";\n\
    add_header Content-Type text/plain;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

COPY --from=build /repo/apps/website/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
