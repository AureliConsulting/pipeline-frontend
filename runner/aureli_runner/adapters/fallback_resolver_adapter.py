"""Stage three — manual review fallback resolution.

Thin adapter around the EXISTING deterministic resolver in the `gtm_research`
package ("GTM Scoring" project, same tree as `GtmScoringPersonalizationAdapter`).
Preserves all of its remediation/validation/quarantine behavior by shelling
out to its real CLI:

  python -m gtm_research resolve-manual-review --input <personalized_final.csv>
    --campaign <yaml> [--config <fallback_rules.json>] --output-dir <dir>
    [--allow-partial]

Exit code 2 is NOT a failure: it means the resolver quarantined at least one
row and `--allow-partial` was not set. `ready_to_push.csv`, `blocked_for_
review.csv`, `fallback_audit.csv` and `run_summary.json` are written either
way — only a non-{0,2} exit (or a launch failure) is a real adapter error.
"""
from __future__ import annotations

import csv
import json
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


class FallbackResolverAdapter(PipelineAdapter):
    name = "fallback_resolver"

    def __init__(self, gtm_dir: Path):
        self.gtm_dir = gtm_dir

    # ------------------------------------------------------------ validation
    def validate_configuration(self, ctx: AdapterContext) -> list[str]:
        problems: list[str] = []
        if not (self.gtm_dir / "gtm_research" / "__main__.py").is_file():
            problems.append(
                f"GTM Scoring project not found at {self.gtm_dir} (set gtm_dir in the runner config)."
            )
        if not self._input_csv(ctx).is_file():
            problems.append("Stage-two personalized CSV is not present in the run workspace.")
        return problems

    def validate_credentials(self, ctx: AdapterContext) -> list[str]:
        return []  # deterministic — no network/API calls

    # -------------------------------------------------------------- helpers
    @staticmethod
    def _input_csv(ctx: AdapterContext) -> Path:
        # Stage two's full personalized output — every row, not just the
        # manual_review subset — since the resolver decides per-row whether
        # remediation is needed and validates every row before delivery.
        finals = sorted(ctx.workspace.output_dir.glob("*_personalized_final.csv"))
        if finals:
            return finals[0]
        return ctx.workspace.output_dir / "personalized_final.csv"

    @staticmethod
    def _campaign_config_path(ctx: AdapterContext) -> Path:
        path = ctx.workspace.input_dir / "campaign_config.yaml"
        if not path.is_file():
            raise PermanentAdapterError(
                f"Campaign configuration was not materialized into the run workspace: {path}"
            )
        return path

    @staticmethod
    def _fallback_rules_path(ctx: AdapterContext) -> Path | None:
        path = ctx.workspace.input_dir / "fallback_rules.json"
        return path if path.is_file() else None

    # ------------------------------------------------------------- execution
    def start_stage(self, ctx: AdapterContext) -> StageResult:
        return self._execute(ctx)

    def resume_stage(self, ctx: AdapterContext) -> StageResult:
        ctx.emit("runner_resumed", "Re-running the fallback resolver (deterministic — safe to redo)")
        return self._execute(ctx)

    def _execute(self, ctx: AdapterContext) -> StageResult:
        problems = self.validate_configuration(ctx)
        if problems:
            raise PermanentAdapterError("; ".join(problems))

        input_csv = self._input_csv(ctx)
        campaign_config = self._campaign_config_path(ctx)
        out_dir = ctx.workspace.output_dir
        rules_path = self._fallback_rules_path(ctx)
        allow_partial = bool(ctx.directive.get("allow_partial"))

        args = [
            python_executable(), "-m", "gtm_research", "resolve-manual-review",
            "--input", str(input_csv),
            "--campaign", str(campaign_config),
            "--output-dir", str(out_dir),
        ]
        if rules_path is not None:
            args += ["--config", str(rules_path)]
        if allow_partial:
            args.append("--allow-partial")

        code = run_streamed(ctx, args, cwd=self.gtm_dir)
        if ctx.cancelled():
            raise AdapterError("Stage cancelled")
        if code not in (0, 2):
            raise AdapterError(f"gtm_research resolve-manual-review exited with code {code}")

        summary = self._read_summary(out_dir)
        warnings: list[str] = []
        blocked_rows = int(summary.get("blocked_rows", 0) or 0)
        if blocked_rows > 0:
            warnings.append(
                f"{blocked_rows} lead(s) blocked for manual review"
                + ("" if allow_partial else " (partial mode was off)")
            )

        counts = {
            key: int(summary.get(key, 0) or 0)
            for key in (
                "input_rows",
                "targeted_rows",
                "remediated_rows",
                "ready_rows",
                "blocked_rows",
                "fallback_changes",
            )
        }
        return StageResult(counts=counts, artifacts=self.collect_artifacts(ctx), warnings=warnings)

    @staticmethod
    def _read_summary(out_dir: Path) -> dict:
        path = out_dir / "run_summary.json"
        if not path.is_file():
            return {}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def collect_artifacts(self, ctx: AdapterContext) -> list[ArtifactOut]:
        out_dir = ctx.workspace.output_dir
        artifacts: list[ArtifactOut] = []
        for file_name, artifact_type in (
            ("ready_to_push.csv", "ready_to_push_csv"),
            ("blocked_for_review.csv", "blocked_for_review_csv"),
            ("fallback_audit.csv", "fallback_audit_csv"),
        ):
            path = out_dir / file_name
            if path.is_file():
                artifacts.append(ArtifactOut(path, artifact_type, _csv_rows(path)))
        summary_path = out_dir / "run_summary.json"
        if summary_path.is_file():
            artifacts.append(ArtifactOut(summary_path, "run_summary_json", None))
        return artifacts


def _csv_rows(path: Path) -> int | None:
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            return max(0, sum(1 for _ in csv.reader(handle)) - 1)
    except OSError:
        return None
