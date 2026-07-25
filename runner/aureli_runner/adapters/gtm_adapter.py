"""Stage two — GTM scoring & personalization.

Thin adapter around the EXISTING `gtm_research` package ("GTM Scoring"
project). Preserves all of its validation, evidence, scoring, resume, caching
and personalization behavior by shelling out to its real CLI:

  python -m gtm_research run --input-csv <verified.csv> --output-csv <out> [--resume|--only-failed]
  python -m gtm_research personalize --input <scored_final> --campaign-config <json> ...

The campaign configuration is authored as YAML in the web app, stored
verbatim, and converted 1:1 to the JSON document the pipeline actually loads
(gtm_research.personalization.campaign_config.CampaignConfig — strict
Pydantic). String values (including spintax) are passed through unmodified.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from .base import (
    AdapterContext,
    AdapterError,
    ArtifactOut,
    PermanentAdapterError,
    PipelineAdapter,
    StageResult,
)
from .subproc import python_executable, run_streamed


class GtmScoringPersonalizationAdapter(PipelineAdapter):
    name = "gtm_research"

    def __init__(self, gtm_dir: Path, workers: int = 5):
        self.gtm_dir = gtm_dir
        self.workers = workers

    # ------------------------------------------------------------ validation
    def validate_configuration(self, ctx: AdapterContext) -> list[str]:
        problems: list[str] = []
        if not (self.gtm_dir / "gtm_research" / "__main__.py").is_file():
            problems.append(
                f"GTM Scoring project not found at {self.gtm_dir} (set gtm_dir in the runner config)."
            )
        if not isinstance(ctx.config_json, dict) or not ctx.config_json.get("campaign_id"):
            problems.append("Campaign configuration is missing campaign_id.")
        if not self._verified_csv(ctx).is_file():
            problems.append("Stage-one verified CSV is not present in the run workspace.")
        return problems

    def validate_credentials(self, ctx: AdapterContext) -> list[str]:
        return [key for key in ("EXA_API_KEY", "DEEPSEEK_API_KEY") if not ctx.credentials.get(key)]

    # -------------------------------------------------------------- helpers
    @staticmethod
    def _verified_csv(ctx: AdapterContext) -> Path:
        # Preferred: the stage-one verified output already in this workspace.
        for candidate in ("verified.csv",):
            path = ctx.workspace.output_dir / candidate
            if path.is_file():
                return path
        finals = sorted(ctx.workspace.output_dir.glob("*_final.csv"))
        if finals:
            return finals[0]
        return ctx.workspace.output_dir / "verified.csv"

    def _write_campaign_json(self, ctx: AdapterContext) -> Path:
        path = ctx.workspace.input_dir / "campaign_config.json"
        path.write_text(json.dumps(ctx.config_json, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def _stdout_json_collector(self):
        """gtm_research prints a JSON report; collect the final JSON object."""
        buffer: list[str] = []

        def handle(line: str) -> bool:
            stripped = line.strip()
            if stripped.startswith("{") or buffer:
                buffer.append(line)
            return False

        def result() -> dict:
            text = "\n".join(buffer)
            start = text.find("{")
            if start < 0:
                return {}
            for end in range(len(text), start, -1):
                try:
                    return json.loads(text[start:end])
                except json.JSONDecodeError:
                    continue
            return {}

        return handle, result

    # ------------------------------------------------------------- execution
    def start_stage(self, ctx: AdapterContext) -> StageResult:
        return self._execute(ctx, resume=False)

    def resume_stage(self, ctx: AdapterContext) -> StageResult:
        ctx.emit(
            "runner_resumed",
            "Resuming GTM pipeline with its native checkpoints (evidence cache + per-company checkpoints)",
        )
        return self._execute(ctx, resume=True)

    def _execute(self, ctx: AdapterContext, resume: bool) -> StageResult:
        missing = self.validate_credentials(ctx)
        if missing:
            raise PermanentAdapterError(f"Missing credentials on this runner: {', '.join(missing)}")
        problems = self.validate_configuration(ctx)
        if problems:
            raise PermanentAdapterError("; ".join(problems))

        input_csv = self._verified_csv(ctx)
        out_dir = ctx.workspace.output_dir
        stem = re.sub(r"[^A-Za-z0-9_-]", "_", input_csv.stem)
        scored_final = out_dir / f"{stem}_scored_final.csv"
        mode = str(ctx.directive.get("mode", ""))

        progress_re = re.compile(r"(\d+)\s*/\s*(\d+)")
        warnings: list[str] = []

        # ---- research + deterministic scoring (gtm_research run) ----
        if mode == "skip_failed" and scored_final.is_file():
            ctx.emit("stage_progress", "Directive skip_failed: merging existing results without re-research")
            merge_args = [
                python_executable(), "-m", "gtm_research", "merge",
                "--input-csv", str(input_csv), "--output-csv", str(scored_final),
            ]
            code = run_streamed(ctx, merge_args, cwd=self.gtm_dir)
            if code != 0:
                raise AdapterError(f"gtm_research merge exited with code {code}")
            warnings.append("Failed rows were skipped by user decision; see failures CSV.")
        else:
            run_args = [
                python_executable(), "-m", "gtm_research", "run",
                "--input-csv", str(input_csv),
                "--output-csv", str(scored_final),
                "--max-concurrency", str(self.workers),
            ]
            if resume:
                run_args.append("--resume")
            if mode == "retry_failed":
                run_args += ["--only-failed", "--resume"]

            handle_json, get_json = self._stdout_json_collector()

            def handle_line(line: str) -> bool:
                handle_json(line)
                match = progress_re.search(line)
                if "remaining" in line.lower() or "completed" in line.lower():
                    ctx.emit("stage_progress", line[:500])
                    return True
                if match and ("/" in line):
                    return False  # let generic log emit; counts come from summary
                return False

            code = run_streamed(ctx, run_args, cwd=self.gtm_dir, line_handler=handle_line)
            if ctx.cancelled():
                raise AdapterError("Stage cancelled")
            if code != 0:
                report = get_json()
                if report.get("error") == "zero_eligible_rows":
                    raise PermanentAdapterError(
                        "0 rows passed the GTM email-verification eligibility gate: "
                        + json.dumps(report.get("observed_values", {}))[:300]
                    )
                raise AdapterError(f"gtm_research run exited with code {code}")
            run_report = get_json()
            failed = int(run_report.get("failed", 0) or 0)
            if failed > 0:
                warnings.append(f"{failed} companies failed research; successful rows are preserved.")
                ctx.emit("row_failed", f"{failed} companies failed research", severity="warn", retry_count=failed)

        if not scored_final.is_file():
            raise AdapterError("Scored final CSV was not produced")

        # ---- personalization (gtm_research personalize) ----
        campaign_json = self._write_campaign_json(ctx)
        personalized = out_dir / f"{stem}_personalized_final.csv"
        send_ready = out_dir / f"{stem}_send_ready.csv"
        manual_review = out_dir / f"{stem}_manual_review.csv"
        personalize_args = [
            python_executable(), "-m", "gtm_research", "personalize",
            "--input-csv", str(scored_final),
            "--output-csv", str(personalized),
            "--campaign-config", str(campaign_json),
            "--send-ready-output", str(send_ready),
            "--manual-review-output", str(manual_review),
            "--workers", str(self.workers),
            "--resume",
        ]
        handle_json2, get_json2 = self._stdout_json_collector()

        def handle_personalize_line(line: str) -> bool:
            handle_json2(line)
            match = progress_re.search(line)
            if match:
                ctx.emit(
                    "stage_progress", line[:300],
                    current_item=int(match.group(1)), total_items=int(match.group(2)),
                )
                return True
            return False

        code = run_streamed(ctx, personalize_args, cwd=self.gtm_dir, line_handler=handle_personalize_line)
        if ctx.cancelled():
            raise AdapterError("Stage cancelled")
        if code != 0:
            raise AdapterError(f"gtm_research personalize exited with code {code}")

        artifacts = self.collect_artifacts(ctx)
        counts = {
            "scored": _csv_rows(scored_final) or 0,
            "personalized": _csv_rows(personalized) or 0,
            "send_ready": _csv_rows(send_ready) or 0,
            "manual_review": _csv_rows(manual_review) or 0,
            "successful": _csv_rows(personalized) or 0,
        }
        failures_csv = next(out_dir.glob("*_failures.csv"), None)
        if failures_csv:
            counts["failed"] = _csv_rows(failures_csv) or 0
        return StageResult(counts=counts, artifacts=artifacts, warnings=warnings)

    def collect_artifacts(self, ctx: AdapterContext) -> list[ArtifactOut]:
        out_dir = ctx.workspace.output_dir
        patterns: list[tuple[str, str]] = [
            ("*_scored_final.csv", "gtm_scored_csv"),
            ("*_personalized_final.csv", "personalized_csv"),
            ("*_send_ready.csv", "instantly_ready_csv"),
            ("*_manual_review.csv", "manual_review_csv"),
            ("*_failures.csv", "rejected_csv"),
            ("*_reconciliation.csv", "evidence_report"),
            ("*_summary.json", "cost_report"),
        ]
        artifacts: list[ArtifactOut] = []
        for pattern, artifact_type in patterns:
            for path in sorted(out_dir.glob(pattern)):
                rows = _csv_rows(path) if path.suffix == ".csv" else None
                artifacts.append(ArtifactOut(path, artifact_type, rows))
        config_snapshot = ctx.workspace.input_dir / "campaign_config.json"
        if config_snapshot.is_file():
            artifacts.append(ArtifactOut(config_snapshot, "config_snapshot", None))
        return artifacts


def _csv_rows(path: Path) -> int | None:
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            return max(0, sum(1 for _ in csv.reader(handle)) - 1)
    except OSError:
        return None
