# =============================================================================
# email-ingest — IMAP-poll service for agent@blankcollar.ai
# =============================================================================

FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /build

COPY pyproject.toml ./
COPY app ./app
RUN pip install --prefix=/install .

# -----------------------------------------------------------------------------

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app
WORKDIR /app

RUN groupadd --system mail && useradd --system --gid mail --home /app mail

COPY --from=builder /install /usr/local
COPY app /app/app

USER mail

# This is a long-running poller; it has no HTTP surface, so we use a
# heartbeat file written by the loop as the healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD test -f /tmp/email-ingest.heartbeat \
   && find /tmp/email-ingest.heartbeat -mmin -5 | grep -q . \
   || exit 1

CMD ["python", "-m", "app.main"]
