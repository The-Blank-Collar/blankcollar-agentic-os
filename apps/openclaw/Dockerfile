# =============================================================================
# OpenClaw — Blank Collar workforce agent (tool / web actions)
#
# Skills shipped:
#   - web.fetch    (httpx + selectolax)
#   - web.search   (Oxylabs AI Studio + DuckDuckGo fallback)
#   - email.send   (aiosmtplib)
#   - web.browse   (playwright + chromium — adds ~400MB to the image)
# =============================================================================

FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends gcc \
 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app
RUN pip install --prefix=/install .

# -----------------------------------------------------------------------------

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

WORKDIR /app

RUN groupadd --system openclaw && useradd --system --gid openclaw --home /app openclaw

COPY --from=builder /install /usr/local

# Install Chromium + the apt deps Playwright needs at runtime. The browser
# binary lands in $PLAYWRIGHT_BROWSERS_PATH; we then hand ownership over to
# the openclaw user so the runtime can read it.
RUN mkdir -p /opt/playwright \
 && playwright install --with-deps chromium \
 && chown -R openclaw:openclaw /opt/playwright \
 && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY app /app/app

USER openclaw
EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --retries=6 --start-period=10s \
  CMD python -c "import urllib.request,sys; \
      sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:80/healthz', timeout=2).getcode()==200 else 1)" \
  || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
