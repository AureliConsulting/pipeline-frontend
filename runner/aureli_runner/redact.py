"""Secret redaction for every log line and event message the runner emits.

Mirrors packages/shared/src/events.ts. The runner redacts BEFORE transmission;
the server redacts again as a backstop.
"""
from __future__ import annotations

import re

_PATTERNS = [
    re.compile(
        r"(?i)(api[_-]?key|apikey|authorization|bearer|token|secret|password|cookie)\s*[=:]\s*\S+"
    ),
    re.compile(r"sk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    re.compile(r"arn_[a-f0-9]{64}"),
]

_KNOWN_KEY_NAMES = (
    "VAYNE_API_KEY",
    "ICYPEAS_API_KEY",
    "ICYPEAS_USER_ID",
    "MILLIONVERIFIER_API_KEY",
    "EXA_API_KEY",
    "DEEPSEEK_API_KEY",
    "INSTANTLY_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
)


def redact(text: str, extra_values: list[str] | None = None) -> str:
    out = text
    for value in extra_values or []:
        if value and len(value) >= 8:
            out = out.replace(value, "[redacted]")
    for pattern in _PATTERNS:
        def _sub(match: re.Match[str]) -> str:
            whole = match.group(0)
            sep = re.search(r"[=:]", whole)
            return f"{whole[: sep.start() + 1]}[redacted]" if sep else "[redacted]"

        out = pattern.sub(_sub, out)
    return out


def redact_url(url: str) -> str:
    """Strip query strings (signed URLs, api=KEY params) before logging."""
    return url.split("?", 1)[0] + ("?…" if "?" in url else "")


def known_credential_names() -> tuple[str, ...]:
    return _KNOWN_KEY_NAMES
