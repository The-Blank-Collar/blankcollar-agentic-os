"""Pure functions that decide what to do with an inbound email.

Two outputs per email:
  1. A `conversation` memory written to gbrain.
  2. (Optional) a `draft` goal in Paperclip if the message looks
     actionable — a request, a question, or has explicit verbs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Words that strongly suggest the sender wants something done.
_ACTION_WORDS = re.compile(
    r"\b("
    r"please|can you|could you|would you|need(?:\s+to)?|"
    r"do|draft|write|send|book|schedule|find|research|summari[sz]e|"
    r"reply|email|fix|build|deploy|publish|post|share"
    r")\b",
    re.IGNORECASE,
)

# A trailing question mark or "thoughts?" pattern usually means a question.
_QUESTION_RE = re.compile(r"\?\s*$|\bthoughts\??\s*$", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class ParsedEmail:
    sender: str
    subject: str
    text: str
    is_actionable: bool

    @property
    def memory_title(self) -> str:
        s = self.subject.strip() or "(no subject)"
        return f"Email from {self.sender}: {s}"[:200]

    @property
    def memory_content(self) -> str:
        return f"From: {self.sender}\nSubject: {self.subject}\n\n{self.text.strip()}"[:8_000]

    @property
    def goal_title(self) -> str:
        s = self.subject.strip()
        if not s:
            head = self.text.strip().splitlines()[0][:80] if self.text.strip() else ""
            return head or "Inbound email request"
        return s[:200]


def parse(*, sender: str, subject: str, text: str) -> ParsedEmail:
    sender = (sender or "").strip()
    subject = (subject or "").strip()
    text = (text or "").strip()

    actionable = bool(_ACTION_WORDS.search(f"{subject}\n{text}")) or bool(
        _QUESTION_RE.search(text)
    )
    return ParsedEmail(sender=sender, subject=subject, text=text, is_actionable=actionable)
