# =============================================================================
# LangGraph Dispatcher — Blank Collar Agentic OS
# A multi-agent orchestrator on top of Hermes + OpenClaw. Speaks the same
# adapter contract (/run, /run/{id}, cancel, /healthz) as the underlying
# agents, so Paperclip can dispatch to it like any other workforce kind.
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

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app
WORKDIR /app

RUN groupadd --system langgraph && useradd --system --gid langgraph --home /app langgraph

COPY --from=builder /install /usr/local
COPY app /app/app

USER langgraph
EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --retries=6 --start-period=15s \
  CMD python -c "import urllib.request,sys; \
      sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:80/healthz', timeout=2).getcode()==200 else 1)" \
  || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
