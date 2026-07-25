"""Safe subprocess execution for pipeline scripts.

- Argument ARRAYS only. Never shell=True, never string concatenation.
- stdout/stderr streamed line-by-line into structured events (redacted).
- Cooperative cancellation: terminates the child when the run is cancelled.
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
from pathlib import Path

from ..redact import redact
from .base import AdapterContext, AdapterError


def python_executable() -> str:
    return sys.executable or "python"


def run_streamed(
    ctx: AdapterContext,
    args: list[str],
    cwd: Path,
    env_extra: dict[str, str] | None = None,
    line_handler=None,
    poll_seconds: float = 0.5,
) -> int:
    """Run a subprocess, forwarding each output line to events. Returns exit code."""
    env = {**os.environ, **(env_extra or {})}
    env.setdefault("PYTHONIOENCODING", "utf-8")
    secret_values = [v for v in ctx.credentials.values() if v]

    try:
        process = subprocess.Popen(  # noqa: S603 — arg list, no shell
            args,
            cwd=str(cwd),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except OSError as exc:
        raise AdapterError(f"Could not start pipeline process: {exc}") from exc

    stop_watcher = threading.Event()

    def watch_cancel() -> None:
        while not stop_watcher.is_set():
            if ctx.cancel_event.wait(timeout=poll_seconds):
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                return
            if process.poll() is not None:
                return

    watcher = threading.Thread(target=watch_cancel, daemon=True)
    watcher.start()

    assert process.stdout is not None
    for raw_line in process.stdout:
        line = redact(raw_line.rstrip(), secret_values)
        if not line:
            continue
        handled = line_handler(line) if line_handler else False
        if not handled:
            ctx.emit("log", line, severity="debug")

    process.wait()
    stop_watcher.set()
    watcher.join(timeout=2)
    return process.returncode
