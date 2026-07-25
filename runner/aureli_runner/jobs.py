"""Runner daemon: claims jobs, executes stages through adapters, streams
events, uploads artifacts, waits for approvals, performs approved Instantly
uploads, and resumes interrupted work after restarts.

One job executes at a time per runner process (multiple runners per user are
supported server-side; a specific job can only ever be claimed by one device
thanks to the atomic claim RPC + claimed_by pinning).
"""
from __future__ import annotations

import hashlib
import platform
import threading
import time
import traceback
from pathlib import Path
from typing import Any

import yaml

from .adapters.base import AdapterContext, PermanentAdapterError, PipelineAdapter, StageResult
from .adapters.gtm_adapter import GtmScoringPersonalizationAdapter
from .adapters.instantly_adapter import InstantlyUploadAdapter
from .adapters.mock_adapter import MockPipelineAdapter
from .adapters.sourcing_adapter import SourcingVerificationAdapter
from .checkpoints import RunState, RunWorkspace, find_incomplete_runs
from .client import ApiError, ControlPlaneClient
from .config import RunnerConfig
from .credentials import detect_statuses, load_credentials
from .events import EventEmitter, utc_now
from .protocol import LIMITS
from .redact import redact
from .retry import classify_error, next_retry


class RunnerDaemon:
    def __init__(
        self,
        config: RunnerConfig,
        client: ControlPlaneClient,
        mock_fast: bool = False,
        poll_seconds: float = 5.0,
    ):
        self.config = config
        self.client = client
        self.mock_fast = mock_fast
        self.poll_seconds = poll_seconds
        self.stop_event = threading.Event()
        self.active_run_id: str | None = None
        self._last_heartbeat = 0.0
        self._last_connection_test_at: str | None = None

    # ------------------------------------------------------------------ loop
    def run_forever(self, once: bool = False) -> None:
        print(f"[runner] online — server {self.client.base}")
        # Crash recovery first: resume claimed-but-unfinished local runs.
        for run_id in find_incomplete_runs():
            print(f"[runner] found incomplete local run {run_id}; resuming")
            job = self._safe_claim(resume_run_id=run_id)
            if job:
                self._execute_job(job, resumed=True)
            elif once:
                return

        while not self.stop_event.is_set():
            self._heartbeat_if_due()
            job = self._safe_claim()
            if job:
                self._execute_job(job)
                if once:
                    return
            else:
                if once:
                    return
                self.stop_event.wait(self.poll_seconds)

    def _safe_claim(self, resume_run_id: str | None = None) -> dict[str, Any] | None:
        try:
            return self.client.claim(resume_run_id=resume_run_id)
        except ApiError as exc:
            print(f"[runner] claim failed: {exc}")
            if exc.status == 401:
                print("[runner] token rejected — was this runner revoked? Re-pair with a new code.")
                self.stop_event.wait(30)
            else:
                self.stop_event.wait(10)
            return None

    def _heartbeat_if_due(self, active_run_id: str | None = None) -> None:
        if time.monotonic() - self._last_heartbeat < LIMITS["heartbeat_interval_seconds"]:
            return
        try:
            body = self.client.heartbeat(
                active_run_id or self.active_run_id,
                detect_statuses(self.config),
                self._last_connection_test_at,
            )
            warning = body.get("protocol_warning")
            if warning:
                print(f"[runner] WARNING: {warning}")
        except ApiError as exc:
            print(f"[runner] heartbeat failed: {exc}")
        self._last_heartbeat = time.monotonic()

    # ------------------------------------------------------------- adapters
    def _adapter_for(self, job: dict[str, Any]) -> PipelineAdapter:
        if job.get("mock"):
            return MockPipelineAdapter()
        if job.get("stage") == "stage_two":
            return GtmScoringPersonalizationAdapter(Path(self.config.gtm_dir))
        return SourcingVerificationAdapter(Path(self.config.sourcing_pipeline_dir))

    # ------------------------------------------------------------- execution
    def _execute_job(self, job: dict[str, Any], resumed: bool = False) -> None:
        run_id = str(job["run_id"])
        self.active_run_id = run_id
        workspace = RunWorkspace(run_id)
        state = workspace.load_state() or RunState(run_id=run_id, mock=bool(job.get("mock")))
        state.stage = str(job.get("stage") or state.stage)
        state.status = "running"
        workspace.save_state(state)

        emitter = EventEmitter(self.client, run_id, workspace.root, start_seq=state.last_event_seq)
        cancel_event = threading.Event()
        stop_watch = threading.Event()

        def emit(event_type: str, message: str, severity: str = "info", **fields: Any) -> None:
            emitter.emit(state.stage, event_type, message, severity=severity, **fields)
            state.last_event_seq = emitter.seq
            workspace.save_state(state)

        # Cancellation/approval watcher: polls run status server-side.
        def watch_status() -> None:
            while not stop_watch.is_set():
                try:
                    body = self.client.run_status(run_id)
                    status = str(body["run"]["status"])
                    if status == "cancelled":
                        cancel_event.set()
                        return
                except ApiError:
                    pass
                stop_watch.wait(10)

        watcher = threading.Thread(target=watch_status, daemon=True)
        watcher.start()

        try:
            job_input = self.client.run_input(run_id)
            self._materialize_inputs(workspace, job_input)
            credentials = {} if job.get("mock") else load_credentials(self.config)
            ctx = AdapterContext(
                run_id=run_id,
                stage=state.stage,
                workspace=workspace,
                campaign_title=str(job_input.get("campaign_title") or "campaign"),
                source=dict(job_input.get("source") or {}),
                config_yaml=str((job_input.get("config") or {}).get("yaml_text") or ""),
                config_json=dict((job_input.get("config") or {}).get("normalized_json") or {}),
                directive=dict(job_input.get("directive") or job.get("directive") or {}),
                credentials=credentials,
                emit=emit,
                cancel_event=cancel_event,
                mock_fast=self.mock_fast,
            )
            adapter = self._adapter_for(job)
            emit("run_claimed" if not resumed else "runner_resumed",
                 f"{'Resumed' if resumed else 'Claimed'} run on {platform.node()} — stage {state.stage}"
                 + (" [MOCK]" if job.get("mock") else ""))

            result = self._run_stage_with_retries(adapter, ctx, emit, resumed)
            if result is None:
                return  # failure already reported

            self._upload_artifacts(ctx, emitter, state, workspace, result)
            emitter.drain()
            self.client.stage_complete(
                run_id,
                {
                    "stage": state.stage,
                    "outcome": "cancelled" if cancel_event.is_set() else "completed",
                    "counts": result.counts,
                    "warnings": result.warnings[:50],
                },
            )
            state.status = "stage_reported"
            state.completed_stages.append(state.stage)
            workspace.save_state(state)
            emit("stage_completed", f"Stage {state.stage} reported to control plane")

            # Wait for the human decision, then continue (next stage /
            # Instantly / done). Browser closure is irrelevant here.
            self._await_next_step(job, workspace, state, ctx, emit, cancel_event)
        except Exception as exc:  # noqa: BLE001 — report, never crash the daemon
            # Any failure past this point (adapter crash, or a control-plane
            # call such as artifact upload/registration failing after its own
            # retries) must still try to report the stage failed, so the run
            # reaches stage_*_failed and the user gets the retry/skip/cancel
            # checkpoint instead of hanging in "running" forever.
            message = redact(f"{type(exc).__name__}: {exc}")
            error_class = "permanent" if isinstance(exc, PermanentAdapterError) else "transient"
            print(f"[runner] run {run_id} crashed: {message}\n{redact(traceback.format_exc())}")
            try:
                self.client.stage_complete(
                    run_id,
                    {
                        "stage": state.stage,
                        "outcome": "failed",
                        "counts": {},
                        "error": message,
                        "error_class": error_class,
                        "warnings": [],
                    },
                )
            except ApiError as report_exc:
                # The control plane itself is unreachable/rejecting us; there
                # is nothing more this process can do for this run right now.
                # It will be picked up again on the next resume (crash
                # recovery via find_incomplete_runs) or the next claim cycle.
                print(f"[runner] could not report failure for run {run_id}: {report_exc}")
        finally:
            stop_watch.set()
            emitter.drain()
            self.active_run_id = None

    def _run_stage_with_retries(self, adapter, ctx, emit, resumed: bool) -> StageResult | None:
        attempt = 1
        use_resume = resumed
        while True:
            try:
                if use_resume:
                    return adapter.resume_stage(ctx)
                return adapter.start_stage(ctx)
            except PermanentAdapterError as exc:
                emit("stage_failed", f"Permanent failure: {exc}", severity="error")
                self.client.stage_complete(
                    ctx.run_id,
                    {
                        "stage": ctx.stage,
                        "outcome": "failed",
                        "counts": {},
                        "error": str(exc),
                        "error_class": "permanent",
                        "warnings": [],
                    },
                )
                return None
            except Exception as exc:  # AdapterError or unexpected
                if ctx.cancelled():
                    self.client.stage_complete(
                        ctx.run_id,
                        {"stage": ctx.stage, "outcome": "cancelled", "counts": {}, "warnings": []},
                    )
                    return None
                message = redact(f"{type(exc).__name__}: {exc}")
                error_class = classify_error(message)
                decision = next_retry(attempt, error_class)
                if decision.retry:
                    emit(
                        "stage_retrying",
                        f"Attempt {attempt} failed ({message}). Retrying in {decision.delay_seconds}s",
                        severity="warn",
                        retry_count=attempt,
                    )
                    time.sleep(decision.delay_seconds)
                    attempt = decision.attempt
                    use_resume = True  # native resume — never redo paid work
                    emit("stage_started", f"Retry attempt {attempt} starting", retry_count=attempt - 1)
                    continue
                emit("stage_failed", f"Retries exhausted: {message}", severity="error")
                self.client.stage_complete(
                    ctx.run_id,
                    {
                        "stage": ctx.stage,
                        "outcome": "failed",
                        "counts": {},
                        "error": message,
                        "error_class": error_class,
                        "warnings": [],
                    },
                )
                return None

    # ----------------------------------------------------------- inputs/outputs
    def _materialize_inputs(self, workspace: RunWorkspace, job_input: dict[str, Any]) -> None:
        source = job_input.get("source") or {}
        csv_url = source.get("csv_signed_url")
        source_csv = workspace.input_dir / "source.csv"
        if csv_url and not source_csv.is_file():
            self.client.download_signed(csv_url, source_csv)
        config = job_input.get("config") or {}
        yaml_text = config.get("yaml_text")
        if yaml_text:
            # Preserve the original YAML byte-for-byte…
            (workspace.input_dir / "campaign_config.yaml").write_text(yaml_text, encoding="utf-8")
            # …and derive the JSON the pipeline actually consumes.
            normalized = config.get("normalized_json")
            if not normalized:
                normalized = yaml.safe_load(yaml_text)
            import json as _json

            (workspace.input_dir / "campaign_config.json").write_text(
                _json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8"
            )

    def _upload_artifacts(self, ctx, emitter, state: RunState, workspace: RunWorkspace, result: StageResult) -> None:
        artifacts = list(result.artifacts)
        # Always ship the structured event log as the full pipeline log artifact.
        events_file = workspace.root / "events.jsonl"
        if events_file.is_file():
            from .adapters.base import ArtifactOut

            artifacts.append(ArtifactOut(events_file, "pipeline_log", None))
        for artifact in artifacts:
            key = f"{ctx.stage}:{artifact.path.name}"
            if state.uploaded_artifacts.get(key):
                continue  # resume: already uploaded
            if not artifact.path.is_file():
                continue
            digest = hashlib.sha256(artifact.path.read_bytes()).hexdigest()
            registration = self.client.register_artifact(
                ctx.run_id,
                {
                    "artifact_type": artifact.artifact_type,
                    "file_name": artifact.path.name,
                    "size_bytes": artifact.path.stat().st_size,
                    "row_count": artifact.row_count,
                    "content_hash": digest,
                    "stage": ctx.stage,
                },
            )
            self.client.upload_signed(registration["signed_url"], artifact.path)
            self.client.confirm_artifact(
                ctx.run_id, registration["artifact_id"], artifact.path.stat().st_size, digest
            )
            state.uploaded_artifacts[key] = str(registration["artifact_id"])
            workspace.save_state(state)
            emitter.emit(ctx.stage, "artifact_uploaded", f"Uploaded {artifact.path.name}")

    # -------------------------------------------------------------- next steps
    def _await_next_step(self, job, workspace, state: RunState, ctx, emit, cancel_event) -> None:
        run_id = state.run_id
        while not self.stop_event.is_set():
            self._heartbeat_if_due(run_id)
            try:
                body = self.client.run_status(run_id)
            except ApiError:
                time.sleep(self.poll_seconds)
                continue
            run = body["run"]
            status = str(run["status"])
            if status in ("completed", "completed_with_warnings", "cancelled"):
                state.status = "done"
                workspace.save_state(state)
                return
            if status == "queued" and run.get("claimed_by"):
                job2 = self._safe_claim(resume_run_id=None)
                if job2 and str(job2.get("run_id")) == run_id:
                    state.stage = str(job2["stage"])
                    state.status = "running"
                    workspace.save_state(state)
                    self._execute_job(job2, resumed=False)
                    return
            if status == "uploading_to_instantly":
                upload = body.get("instantly_upload")
                if upload and upload.get("status") in ("approved", "failed", "uploading"):
                    self._perform_instantly(job, workspace, state, ctx, emit, upload)
                    # loop continues; server transitions to completed on success
            time.sleep(self.poll_seconds)

    def _perform_instantly(self, job, workspace, state: RunState, ctx, emit, upload: dict[str, Any]) -> None:
        run_id = state.run_id
        key = str(upload["idempotency_key"])
        if state.instantly_done:
            return
        try:
            self.client.instantly_progress(run_id, {"idempotency_key": key, "state": "started"})
            ctx.stage = "instantly_upload"
            send_ready = self._find_send_ready(workspace)
            if send_ready is None:
                raise PermanentAdapterError("No Instantly-ready CSV in the local run workspace")
            if job.get("mock"):
                uploaded = MockPipelineAdapter().instantly_upload(ctx, int(upload.get("lead_count") or 0))
            else:
                api_key = load_credentials(self.config).get("INSTANTLY_API_KEY", "")
                adapter = InstantlyUploadAdapter(api_key)
                uploaded = adapter.upload_leads(ctx, send_ready, str(upload["list_id"]))
            self.client.instantly_progress(
                run_id,
                {"idempotency_key": key, "state": "completed", "uploaded_count": uploaded},
            )
            state.instantly_done = True
            workspace.save_state(state)
            emit("instantly_upload_completed", f"Instantly upload finished ({uploaded} leads)")
        except Exception as exc:  # noqa: BLE001
            message = redact(f"{type(exc).__name__}: {exc}")
            emit("instantly_upload_failed", message, severity="error")
            try:
                self.client.instantly_progress(
                    run_id, {"idempotency_key": key, "state": "failed", "error": message}
                )
            except ApiError:
                pass
            time.sleep(5)

    @staticmethod
    def _find_send_ready(workspace: RunWorkspace):
        for pattern in ("*send_ready*.csv", "*instantly_ready*.csv"):
            found = sorted(workspace.output_dir.glob(pattern))
            if found:
                return found[0]
        return None
