"""Brand Foundation loader (design.md format).

Loads `<BRAND_DIR>/<BRAND_NAME>.md` at startup, parses the recognised
sections, and exposes `brand.system_prompt_block()` — a compact, LLM-ready
block that Hermes prepends to its system prompt so every reply carries the
voice, banned words, and positioning of the org speaking through it.

The format spec lives in `docs/DESIGN_MD.md`. The loader is forgiving:
missing sections are skipped; an absent file disables the block (returns
empty string) so the agent still works in environments without a brand.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path

log = logging.getLogger("hermes.brand")

_SECTION_RE = re.compile(r"^##\s+(.+?)\s*$")
_BULLET_RE = re.compile(r"^\s*[-*]\s+(.*)$")

_RECOGNISED = {
    "promise", "voice", "banned words", "preferred words",
    "examples", "positioning", "closing line",
}


def _normalise_section(name: str) -> str:
    return name.strip().lower()


def _split_csv(line: str) -> list[str]:
    return [w.strip().strip(".").lower() for w in line.split(",") if w.strip()]


def parse(text: str) -> dict[str, object]:
    """Parse a Brand Foundation markdown into a dict of sections.

    Returns keys among: promise, voice, banned, preferred, examples,
    positioning, closing. Missing sections are absent from the dict.
    """
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("> ") or line.startswith(">"):
            continue  # skip blockquotes (used for the file's own preamble)
        m = _SECTION_RE.match(line)
        if m:
            name = _normalise_section(m.group(1))
            current = name if name in _RECOGNISED else None
            if current and current not in sections:
                sections[current] = []
            continue
        if current and line.strip():
            sections[current].append(line)

    out: dict[str, object] = {}

    def _bullets(lines: list[str]) -> list[str]:
        items: list[str] = []
        for ln in lines:
            mb = _BULLET_RE.match(ln)
            if mb:
                items.append(mb.group(1).strip())
        return items

    def _freeform(lines: list[str]) -> str:
        return " ".join(ln.strip() for ln in lines if ln.strip()).strip()

    if "promise" in sections:
        out["promise"] = _freeform(sections["promise"])
    if "voice" in sections:
        out["voice"] = _bullets(sections["voice"]) or [_freeform(sections["voice"])]
    if "banned words" in sections:
        joined = " ".join(ln for ln in sections["banned words"] if not _BULLET_RE.match(ln))
        out["banned"] = _split_csv(joined) if joined else _bullets(sections["banned words"])
    if "preferred words" in sections:
        joined = " ".join(ln for ln in sections["preferred words"] if not _BULLET_RE.match(ln))
        out["preferred"] = _split_csv(joined) if joined else _bullets(sections["preferred words"])
    if "examples" in sections:
        out["examples"] = _bullets(sections["examples"])
    if "positioning" in sections:
        out["positioning"] = _freeform(sections["positioning"])
    if "closing line" in sections:
        out["closing"] = _freeform(sections["closing line"])

    return out


def system_prompt_block(brand: dict[str, object]) -> str:
    if not brand:
        return ""
    lines: list[str] = ["[Brand Foundation]"]
    if brand.get("promise"):
        lines.append(f"Promise: {brand['promise']}")
    voice = brand.get("voice") or []
    if voice:
        lines.append("Voice: " + "; ".join(voice))  # type: ignore[arg-type]
    banned = brand.get("banned") or []
    if banned:
        lines.append("Avoid these words and phrases: " + ", ".join(banned))  # type: ignore[arg-type]
    preferred = brand.get("preferred") or []
    if preferred:
        lines.append("Prefer these words: " + ", ".join(preferred))  # type: ignore[arg-type]
    examples = brand.get("examples") or []
    if examples:
        lines.append("Tone examples:")
        for ex in examples[:6]:  # type: ignore[union-attr]
            lines.append(f"  - {ex}")
    if brand.get("positioning"):
        lines.append(f"Positioning: {brand['positioning']}")
    if brand.get("closing"):
        lines.append(f"Closing: {brand['closing']}")
    return "\n".join(lines)


def find_banned(text: str, banned: list[str]) -> list[str]:
    """Return banned terms that appear (case-insensitive, word-boundary) in text."""
    found: list[str] = []
    if not text or not banned:
        return found
    haystack = text.lower()
    for term in banned:
        t = term.lower().strip()
        if not t:
            continue
        if " " in t or "-" in t:
            if t in haystack:
                found.append(t)
            continue
        if re.search(rf"(?<!\w){re.escape(t)}(?!\w)", haystack):
            found.append(t)
    return found


def load(brand_dir: str | os.PathLike[str], name: str) -> dict[str, object]:
    """Load a Brand Foundation file by name (without .md). Empty dict if missing."""
    path = Path(brand_dir) / f"{name}.md"
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        log.info("brand: no file at %s — skipping brand block", path)
        return {}
    except Exception as e:
        log.warning("brand: failed to read %s: %s", path, e)
        return {}
    parsed = parse(text)
    log.info(
        "brand: loaded %s (%d voice lines, %d banned, %d preferred)",
        path,
        len(parsed.get("voice") or []),  # type: ignore[arg-type]
        len(parsed.get("banned") or []),  # type: ignore[arg-type]
        len(parsed.get("preferred") or []),  # type: ignore[arg-type]
    )
    return parsed
