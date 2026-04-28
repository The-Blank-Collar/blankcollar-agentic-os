"""Embedding provider abstraction.

Default: OpenAI `text-embedding-3-small`.
Fallback (no API key set): a deterministic hash-based fake of the same dimension —
the service stays runnable offline; recall ranks by lexical-ish overlap, not meaning.
A loud log line warns when the fake is in use.
"""

from __future__ import annotations

import hashlib
import logging
import math
from typing import Protocol

import httpx

from app.config import settings

log = logging.getLogger("gbrain.embeddings")


class Embedder(Protocol):
    name: str

    async def embed(self, text: str) -> list[float]: ...


# ---------- OpenAI ----------------------------------------------------------


class OpenAIEmbedder:
    name = "openai"

    def __init__(self, api_key: str, model: str, dim: int) -> None:
        self._api_key = api_key
        self._model = model
        self._dim = dim
        self._client = httpx.AsyncClient(
            base_url="https://api.openai.com/v1",
            timeout=20.0,
            headers={"Authorization": f"Bearer {self._api_key}"},
        )

    async def embed(self, text: str) -> list[float]:
        r = await self._client.post(
            "/embeddings",
            json={"model": self._model, "input": text},
        )
        r.raise_for_status()
        data = r.json()
        vec = data["data"][0]["embedding"]
        if len(vec) != self._dim:
            raise RuntimeError(
                f"Embedding dim mismatch: model returned {len(vec)}, configured {self._dim}"
            )
        return vec

    async def aclose(self) -> None:
        await self._client.aclose()


# ---------- Deterministic fake ---------------------------------------------


class FakeEmbedder:
    """Deterministic, dimensional, terrible-at-meaning. For offline dev only.

    Produces a unit vector by hashing tokens of the text into the embedding space.
    Identical text → identical vector. Similar tokens → some overlap. Real semantics → none.
    """

    name = "fake"

    def __init__(self, dim: int) -> None:
        self._dim = dim

    async def embed(self, text: str) -> list[float]:
        vec = [0.0] * self._dim
        tokens = text.lower().split()
        if not tokens:
            tokens = [text.lower()]
        for tok in tokens:
            h = hashlib.sha256(tok.encode("utf-8")).digest()
            # Mix the hash bytes into all dimensions
            for i in range(self._dim):
                b = h[i % len(h)]
                vec[i] += (b / 255.0) - 0.5
        # L2-normalize
        norm = math.sqrt(sum(x * x for x in vec))
        if norm == 0:
            return vec
        return [x / norm for x in vec]

    async def aclose(self) -> None:  # parity with OpenAI
        return


# ---------- Factory ---------------------------------------------------------


def make_embedder() -> Embedder:
    if settings.openai_api_key:
        log.info("embedder=openai model=%s dim=%d", settings.embed_model, settings.embed_dim)
        return OpenAIEmbedder(
            api_key=settings.openai_api_key,
            model=settings.embed_model,
            dim=settings.embed_dim,
        )
    log.warning(
        "embedder=FAKE — set OPENAI_API_KEY for real semantic recall. "
        "Service remains runnable but recall quality is meaningless."
    )
    return FakeEmbedder(dim=settings.embed_dim)
