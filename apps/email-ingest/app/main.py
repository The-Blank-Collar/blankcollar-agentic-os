"""Inbound email poller.

Loop:
  1. Connect to IMAP, open INBOX (or `IMAP_FOLDER`).
  2. Fetch every UNSEEN message.
  3. For each message:
     - Write a `conversation` memory to gbrain.
     - If the parser flags it actionable, POST to Paperclip's /api/capture.
       The classifier on the server decides goal kind (ephemeral / decision /
       standing / routine).
     - Mark the message as SEEN.
  4. Sleep `EMAIL_POLL_INTERVAL_S`.

Touches /tmp/email-ingest.heartbeat each loop so the Docker healthcheck can
confirm the poller hasn't died silently.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

import httpx
from imap_tools import AND, MailBox, MailBoxUnencrypted

from app import __version__
from app.config import settings
from app.parser import parse
from app.sinks import create_capture, get_org_id, write_conversation_memory

HEARTBEAT_PATH = "/tmp/email-ingest.heartbeat"

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("email-ingest")


def _heartbeat() -> None:
    try:
        os.utime(HEARTBEAT_PATH, None)
    except FileNotFoundError:
        with open(HEARTBEAT_PATH, "w") as f:
            f.write(str(time.time()))


def _connect():
    if settings.imap_use_ssl:
        return MailBox(settings.imap_host, port=settings.imap_port).login(
            settings.imap_user, settings.imap_password, initial_folder=settings.imap_folder
        )
    return MailBoxUnencrypted(settings.imap_host, port=settings.imap_port).login(
        settings.imap_user, settings.imap_password, initial_folder=settings.imap_folder
    )


async def _process_messages(client: httpx.AsyncClient, org_id: str) -> int:
    """Returns the number of messages processed."""
    processed = 0
    # imap-tools is sync; run in a thread so we don't block the loop too long.
    with await asyncio.to_thread(_connect) as mailbox:
        for msg in mailbox.fetch(AND(seen=False), mark_seen=False):
            sender = msg.from_ or ""
            subject = msg.subject or ""
            text = (msg.text or msg.html or "").strip()

            parsed = parse(sender=sender, subject=subject, text=text)

            metadata = {
                "from": parsed.sender,
                "subject": parsed.subject,
                "message_id": msg.uid,
                "received_at": msg.date_str,
                "actionable": parsed.is_actionable,
                "source": "email-ingest",
            }

            memory_id = await write_conversation_memory(
                client,
                org_id=org_id,
                title=parsed.memory_title,
                content=parsed.memory_content,
                metadata=metadata,
            )

            capture_result: dict[str, Any] | None = None
            if parsed.is_actionable:
                # Send the original email body (with sender + subject context)
                # to /api/capture. Paperclip's classifier decides whether this
                # is an ephemeral task, a decision, a standing goal, or a
                # routine, and creates the right shape downstream.
                capture_result = await create_capture(
                    client,
                    raw_content=parsed.memory_content,
                    metadata={**metadata, "memory_id": memory_id},
                )

            goal_id = capture_result.get("goal_id") if capture_result else None
            intent_kind = (
                (capture_result.get("intent") or {}).get("kind")
                if capture_result
                else None
            )
            log.info(
                "ingested uid=%s actionable=%s memory_id=%s goal_id=%s kind=%s",
                msg.uid,
                parsed.is_actionable,
                memory_id,
                goal_id,
                intent_kind,
            )

            # Only mark SEEN once we've stored it somewhere.
            if memory_id or goal_id:
                mailbox.flag(msg.uid, "\\Seen", True)
            processed += 1
    return processed


async def main() -> None:
    log.info(
        "email-ingest starting version=%s host=%s user=%s folder=%s interval=%ss",
        __version__,
        settings.imap_host,
        settings.imap_user,
        settings.imap_folder,
        settings.poll_interval_s,
    )
    if not settings.imap_host or not settings.imap_user:
        log.warning(
            "IMAP_HOST / IMAP_USER not set — running in idle/heartbeat-only mode. "
            "Set them in .env to enable real polling."
        )

    async with httpx.AsyncClient(timeout=20.0) as client:
        org_id: str | None = None
        while True:
            _heartbeat()

            if settings.imap_host and settings.imap_user:
                if org_id is None:
                    org_id = await get_org_id(client)
                    if org_id is None:
                        log.warning("could not resolve org id; will retry next tick")

                if org_id is not None:
                    try:
                        n = await _process_messages(client, org_id)
                        if n:
                            log.info("processed %d new message(s)", n)
                    except Exception:
                        log.exception("poll cycle failed")

            await asyncio.sleep(settings.poll_interval_s)


if __name__ == "__main__":
    asyncio.run(main())
