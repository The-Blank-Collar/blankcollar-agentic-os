# =============================================================================
# gbrain — Blank Collar memory layer
# Multi-stage Python 3.12 image. Small, no build tools in the runtime image.
# =============================================================================

FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build

# Install only what's needed to build wheels (psycopg/asyncpg ship wheels, but be safe)
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libpq-dev \
 && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app

# Install into an isolated prefix we can copy into the runtime image
RUN pip install --prefix=/install .

# -----------------------------------------------------------------------------

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

# Non-root user
RUN groupadd --system gbrain && useradd --system --gid gbrain --home /app gbrain

# Bring in installed packages and the app source
COPY --from=builder /install /usr/local
COPY app /app/app

USER gbrain

EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=6 --start-period=10s \
  CMD python -c "import urllib.request,sys; \
      sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:80/healthz', timeout=2).getcode()==200 else 1)" \
  || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
