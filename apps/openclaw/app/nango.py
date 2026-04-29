"""nango.invoke — proxy through self-hosted Nango to any registered integration.

Nango handles the OAuth dance + token refresh for 400+ services (Slack,
Notion, GitHub, HubSpot, Google Workspace, etc.). After a connection is
created in Nango's Connect UI, agents call any provider endpoint via
Nango's `/proxy` endpoint and Nango injects the right credentials.

Docs: https://docs.nango.dev/reference/api/proxy/get
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger("openclaw.nango")


class NangoError(RuntimeError):
    pass


_VALID_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


def _validate_endpoint(endpoint: str) -> str:
    """Endpoint may be a full URL the provider expects, or a path. Either is
    fine; we just guard against obviously malformed input."""
    s = (endpoint or "").strip()
    if not s:
        raise NangoError("nango.invoke requires `endpoint`")
    if "\n" in s or "\r" in s or "\0" in s:
        raise NangoError("invalid characters in endpoint")
    if len(s) > 2_000:
        raise NangoError("endpoint too long (max 2000 chars)")
    return s


async def nango_invoke(
    *,
    provider_config_key: str,
    connection_id: str,
    endpoint: str,
    method: str = "GET",
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    body: Any = None,
) -> dict[str, Any]:
    """Proxy a single request through Nango.

    Args:
        provider_config_key: name of the integration in Nango (e.g. "slack").
        connection_id: which connection (per-customer) to use.
        endpoint: provider endpoint, e.g. "/api/chat.postMessage" or full URL.
        method: HTTP verb.
        params: query string.
        headers: extra request headers (Nango overrides any auth header).
        body: JSON body for POST/PUT/PATCH.

    Returns a dict with status, body (JSON-decoded if possible), and meta.
    Raises NangoError on validation failures or transport errors.
    """
    if not settings.nango_secret_key:
        raise NangoError(
            "NANGO_SECRET_KEY is not set — find it in the Nango dashboard "
            "(Environment Settings → Secret Key) and add it to .env."
        )

    method = (method or "GET").upper()
    if method not in _VALID_METHODS:
        raise NangoError(
            f"unsupported method {method!r}; expected one of {sorted(_VALID_METHODS)}"
        )

    if not provider_config_key:
        raise NangoError("nango.invoke requires `provider_config_key`")
    if not connection_id:
        raise NangoError("nango.invoke requires `connection_id`")

    endpoint_clean = _validate_endpoint(endpoint)

    nango_headers = {
        "Authorization": f"Bearer {settings.nango_secret_key}",
        "Provider-Config-Key": provider_config_key,
        "Connection-Id": connection_id,
    }
    if headers:
        # Don't allow callers to overwrite Nango's auth/routing headers.
        for k, v in headers.items():
            if k.lower() in {"authorization", "provider-config-key", "connection-id"}:
                continue
            nango_headers[k] = v

    proxy_url = f"{settings.nango_url.rstrip('/')}/proxy{endpoint_clean if endpoint_clean.startswith('/') else '/' + endpoint_clean}"

    log.info(
        "nango.invoke %s %s (provider=%s, connection=%s)",
        method, endpoint_clean, provider_config_key, connection_id,
    )

    try:
        async with httpx.AsyncClient(timeout=settings.nango_request_timeout_s) as client:
            r = await client.request(
                method,
                proxy_url,
                headers=nango_headers,
                params=params or None,
                json=body if body is not None else None,
            )
    except Exception as e:
        raise NangoError(f"nango proxy transport error: {e}") from e

    # Try JSON; fall back to text.
    try:
        decoded: Any = r.json()
    except Exception:
        decoded = (r.text or "")[:4_000]

    return {
        "status": r.status_code,
        "ok": 200 <= r.status_code < 300,
        "body": decoded,
        "provider_config_key": provider_config_key,
        "connection_id": connection_id,
        "endpoint": endpoint_clean,
        "method": method,
    }
