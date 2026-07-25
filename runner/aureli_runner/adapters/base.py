"""Adapter boundary around the existing Python pipelines.

The frontend and job loop only ever talk to this interface, so pipeline
implementations can be replaced without touching the web app:

    validate_configuration()  -> list of problems (empty = ok)
    validate_credentials()    -> list of missing/invalid credential names
    start_stage()             -> StageResult
    resume_stage()            -> StageResult (native resume when available)
    cancel_stage()            -> request cooperative cancellation
    collect_artifacts()       -> outputs produced by the stage
    report_progress           -> via ctx.emit(...) structured events

Existing pipeline logic is NEVER reimplemented here — adapters shell out to
the real scripts with argument arrays (no shell=True, no string concat).
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from ..checkpoints import RunWorkspace


class AdapterError(RuntimeError):
    """Transient by default — the job loop applies the retry policy."""


class PermanentAdapterError(AdapterError):
    """Configuration/credential/validation failure. Never auto-retried."""


@dataclass
class ArtifactOut:
    path: Path
    artifact_type: str
    row_count: int | None = None


@dataclass
class StageResult:
    counts: dict[str, int] = field(default_factory=dict)
    artifacts: list[ArtifactOut] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class AdapterContext:
    run_id: str
    stage: str
    workspace: RunWorkspace
    campaign_title: str
    source: dict[str, Any]
    config_yaml: str
    config_json: dict[str, Any]
    directive: dict[str, Any]
    credentials: dict[str, str]
    emit: Callable[..., None]  # emit(event_type, message, severity=..., **fields)
    cancel_event: threading.Event
    mock_fast: bool = False

    def cancelled(self) -> bool:
        return self.cancel_event.is_set()


class PipelineAdapter:
    name = "abstract"

    def validate_configuration(self, ctx: AdapterContext) -> list[str]:
        return []

    def validate_credentials(self, ctx: AdapterContext) -> list[str]:
        return []

    def start_stage(self, ctx: AdapterContext) -> StageResult:
        raise NotImplementedError

    def resume_stage(self, ctx: AdapterContext) -> StageResult:
        # Default: adapters that lack native resume restart the stage. The job
        # loop only calls resume for interrupted work; completed stages are
        # never re-run (their completion is recorded server-side).
        return self.start_stage(ctx)

    def cancel_stage(self, ctx: AdapterContext) -> None:
        ctx.cancel_event.set()

    def collect_artifacts(self, ctx: AdapterContext) -> list[ArtifactOut]:
        return []


class DirectSalesNavigatorAdapter(PipelineAdapter):
    """Deliberately disabled in version one.

    Direct LinkedIn scraping is out of scope; Sales Navigator ingestion goes
    through Vayne. This class exists so a compliant implementation can slot in
    later without frontend changes. No LinkedIn cookie is ever stored in the
    browser or the cloud database.
    """

    name = "direct_sales_navigator_disabled"

    def start_stage(self, ctx: AdapterContext) -> StageResult:
        raise PermanentAdapterError(
            "DirectSalesNavigatorAdapter is disabled in version one. "
            "Use the Vayne-based sourcing pipeline."
        )
