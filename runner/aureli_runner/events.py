"""Structured event emission with batching, monotonic sequence numbers, and
crash-safe acknowledgement tracking.

Every event gets a per-run `seq`; the server enforces UNIQUE(run_id, seq), so
re-sending a batch after a network failure or crash is harmless. The last
acknowledged seq is persisted in the run's local state file, and the full
event stream is appended to events.jsonl (uploaded later as the pipeline_log
artifact — raw logs are NOT stored row-by-row in Postgres).
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .client import ControlPlaneClient
from .protocol import LIMITS
from .redact import redact


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class EventEmitter:
    def __init__(
        self,
        client: ControlPlaneClient,
        run_id: str,
        workdir: Path,
        start_seq: int = 0,
        flush_interval: float = 2.0,
    ):
        self.client = client
        self.run_id = run_id
        self.workdir = workdir
        self.seq = start_seq
        self.flush_interval = flush_interval
        self.pending: list[dict[str, Any]] = []
        self.lock = threading.Lock()
        self.last_flush = 0.0
        self.jsonl_path = workdir / "events.jsonl"
        self.last_acked_seq = start_seq - 1

    def emit(
        self,
        stage: str,
        event_type: str,
        message: str,
        severity: str = "info",
        **fields: Any,
    ) -> None:
        with self.lock:
            event = {
                "seq": self.seq,
                "stage": stage,
                "ts": utc_now(),
                "severity": severity,
                "event_type": event_type,
                "message": redact(message)[:2000],
            }
            for key in (
                "current_item",
                "total_items",
                "exa_query_count",
                "retry_count",
                "cost_usd",
                "metadata",
            ):
                if key in fields and fields[key] is not None:
                    event[key] = fields[key]
            self.seq += 1
            self.pending.append(event)
            with self.jsonl_path.open("a", encoding="utf-8") as out:
                out.write(json.dumps(event, ensure_ascii=False) + "\n")
        if len(self.pending) >= LIMITS["event_batch_max"] or (
            time.monotonic() - self.last_flush > self.flush_interval
        ):
            self.flush()

    def flush(self) -> None:
        with self.lock:
            batch = self.pending[: LIMITS["event_batch_max"]]
            if not batch:
                self.last_flush = time.monotonic()
                return
        try:
            self.client.post_events(self.run_id, batch)
            with self.lock:
                self.last_acked_seq = batch[-1]["seq"]
                self.pending = self.pending[len(batch):]
                self.last_flush = time.monotonic()
        except Exception:
            # Keep events pending; idempotent seq means a later retry is safe.
            self.last_flush = time.monotonic()

    def drain(self, attempts: int = 3) -> None:
        for _ in range(attempts):
            if not self.pending:
                return
            self.flush()
            if self.pending:
                time.sleep(1.0)
