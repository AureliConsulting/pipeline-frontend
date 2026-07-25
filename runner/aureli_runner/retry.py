"""Retry policy — mirrors packages/shared/src/retry.ts (same vectors pinned in
tests on both sides). Transient errors back off exponentially with jitter up
to max_automatic_attempts; permanent errors never auto-retry."""
from __future__ import annotations

import random as _random
from dataclasses import dataclass

from .protocol import RETRY_POLICY

PERMANENT_MARKERS = [
    "invalid api key",
    "invalid credentials",
    "unauthorized",
    "forbidden",
    "payment required",
    "invalid yaml",
    "invalid json",
    "malformed csv",
    "missing required column",
    "validation error",
    "schema violation",
]

TRANSIENT_MARKERS = [
    "timeout",
    "timed out",
    "temporarily unavailable",
    "connection reset",
    "connection refused",
    "rate limit",
    "too many requests",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "econnreset",
    "socket hang up",
]


def classify_error(message: str, http_status: int | None = None) -> str:
    if http_status is not None:
        if http_status in (408, 429) or http_status >= 500:
            return "transient"
        if 400 <= http_status < 500:
            return "permanent"
    lower = message.lower()
    if any(marker in lower for marker in PERMANENT_MARKERS):
        return "permanent"
    if any(marker in lower for marker in TRANSIENT_MARKERS):
        return "transient"
    return "transient"


@dataclass
class RetryDecision:
    retry: bool
    delay_seconds: float
    attempt: int


def next_retry(attempt: int, error_class: str, rng=None) -> RetryDecision:
    """attempt is the 1-based attempt number that just failed."""
    policy = RETRY_POLICY
    if error_class == "permanent" or attempt >= policy["max_automatic_attempts"]:
        return RetryDecision(False, 0.0, attempt)
    exp = policy["base_delay_seconds"] * (2 ** (attempt - 1))
    capped = min(exp, policy["max_delay_seconds"])
    r = (rng() if rng else _random.random()) * 2 - 1
    jitter = capped * policy["jitter_fraction"] * r
    return RetryDecision(True, max(0.5, round(capped + jitter, 1)), attempt + 1)
