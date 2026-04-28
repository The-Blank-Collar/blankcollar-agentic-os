"""email.send skill — SMTP send via the dedicated `agent@blankcollar.ai` mailbox.

Without SMTP credentials configured, returns a "drafted" status so the
pipeline still finishes; the message is still recorded as a memory.
"""

from __future__ import annotations

import logging
import re
from email.message import EmailMessage

import aiosmtplib

from app.config import settings

log = logging.getLogger("openclaw.email")


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class EmailSendError(RuntimeError):
    pass


def _is_valid_address(addr: str) -> bool:
    return bool(_EMAIL_RE.match(addr.strip()))


async def email_send(
    *,
    to: str,
    subject: str,
    body: str,
    cc: list[str] | None = None,
    reply_to: str | None = None,
) -> dict[str, object]:
    if not _is_valid_address(to):
        raise EmailSendError(f"invalid `to` address: {to!r}")
    cc = cc or []
    for c in cc:
        if not _is_valid_address(c):
            raise EmailSendError(f"invalid cc address: {c!r}")

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    if cc:
        msg["Cc"] = ", ".join(cc)
    if reply_to:
        msg["Reply-To"] = reply_to
    msg["Subject"] = subject or "(no subject)"
    msg.set_content(body or "")

    # No SMTP credentials? Return a "drafted" status — the pipeline still
    # records the message and downstream jobs can deliver later.
    if not settings.smtp_host or not settings.smtp_user:
        log.warning(
            "SMTP_HOST / SMTP_USER not set — email NOT sent. Set them in .env "
            "to enable real delivery. Run still succeeds with status=drafted."
        )
        return {
            "delivered": False,
            "status": "drafted",
            "to": to,
            "subject": msg["Subject"],
            "from": msg["From"],
        }

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settings.smtp_password,
            start_tls=not settings.smtp_use_tls,  # 587 → STARTTLS
            use_tls=settings.smtp_use_tls,         # 465 → implicit TLS
            timeout=settings.smtp_timeout_s,
        )
    except Exception as e:
        raise EmailSendError(f"SMTP send failed: {e}") from e

    return {
        "delivered": True,
        "status": "sent",
        "to": to,
        "subject": msg["Subject"],
        "from": msg["From"],
    }
