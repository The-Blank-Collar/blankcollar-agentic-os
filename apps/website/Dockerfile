# =============================================================================
# Website — blankcollar.ai console
# Multi-stage: Node 22 builds the SPA → nginx:alpine serves the static dist.
# =============================================================================

FROM node:22-bookworm-slim AS deps

ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /build
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

# -----------------------------------------------------------------------------

FROM node:22-bookworm-slim AS build

ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY package.json tsconfig.json vite.config.ts index.html ./
COPY src ./src
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

COPY --from=build /build/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
