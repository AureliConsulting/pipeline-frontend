"""Stage one — sourcing & verification.

Wraps the EXISTING script `pipeline.py` (LinkedIn Sales Navigator → Vayne →
Icypeas → MillionVerifier) as a thin adapter. The script is the source of
truth for stage order, provider calls, output naming, and resume behavior:

  outputs:  <name>_vayne_raw.csv, <name>_icypeas_results.csv,
            <name>_combined.csv, <name>_mv_progress.csv (native resume
            checkpoint), <name>_final.csv (verified 'good' rows only)

Two input modes:
  * sales_navigator — full pipeline: --url <sales nav url> --limit N
  * csv             — the canonical v1 upload is ALREADY enriched + verified
    (Icypeas Email/Status + MillionVerifier quality/result columns), so this
    adapter gates it locally using the same vendor-priority rules as the GTM
    pipeline's input loader, producing verified/invalid CSVs with zero paid
    calls. Raw Vayne "simple" exports are run through pipeline.py
    --skip-vayne so Icypeas + MillionVerifier still execute for them.

Nothing from pipeline.py is reimplemented for the paid paths.
"""
from __future__ import annotations

import csv
import re
from pathlib import Path

from .base import (
    AdapterContext,
    ArtifactOut,
    PermanentAdapterError,
    AdapterError,
    PipelineAdapter,
    StageResult,
)
from .csv_gate import gate_csv
from .subproc import python_executable, run_streamed


def slug(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name.strip()) or "campaign"


class SourcingVerificationAdapter(PipelineAdapter):
    name = "vayne_icypeas_millionverifier"

    def __init__(self, pipeline_dir: Path):
        self.pipeline_dir = pipeline_dir

    # ------------------------------------------------------------ validation
    def validate_configuration(self, ctx: AdapterContext) -> list[str]:
        problems: list[str] = []
        if not (self.pipeline_dir / "pipeline.py").is_file():
            problems.append(
                f"Sourcing pipeline not found at {self.pipeline_dir}/pipeline.py "
                "(set sourcing_pipeline_dir in the runner config)."
            )
        source_type = ctx.source.get("type")
        if source_type == "sales_navigator":
            url = str(ctx.source.get("url", ""))
            if not url.startswith("https://www.linkedin.com/sales/") and not url.startswith(
                "https://linkedin.com/sales/"
            ):
                problems.append("Source URL is not a Sales Navigator URL.")
        elif source_type == "csv":
            if not (ctx.workspace.input_dir / "source.csv").is_file():
                problems.append("Source CSV was not downloaded into the run workspace.")
        else:
            problems.append(f"Unknown source type: {source_type!r}")
        return problems

    def validate_credentials(self, ctx: AdapterContext) -> list[str]:
        if ctx.source.get("type") == "csv":
            return []  # local gating only — no paid calls
        required = ["VAYNE_API_KEY", "ICYPEAS_API_KEY", "ICYPEAS_USER_ID", "MILLIONVERIFIER_API_KEY"]
        return [key for key in required if not ctx.credentials.get(key)]

    # ------------------------------------------------------------- execution
    def start_stage(self, ctx: AdapterContext) -> StageResult:
        if ctx.source.get("type") == "csv":
            return self._run_csv_mode(ctx)
        return self._run_sales_navigator(ctx, resume=False)

    def resume_stage(self, ctx: AdapterContext) -> StageResult:
        if ctx.source.get("type") == "csv":
            return self._run_csv_mode(ctx)  # deterministic + free — safe to redo
        # pipeline.py resumes natively: Vayne reuses the existing order (409
        # path), Icypeas reuses submitted batches by name, MillionVerifier
        # resumes from <name>_mv_progress.csv. Never re-pays for finished work.
        ctx.emit("runner_resumed", "Resuming sourcing pipeline using native checkpoints")
        return self._run_sales_navigator(ctx, resume=True)

    # ------------------------------------------------------------ csv path
    def _run_csv_mode(self, ctx: AdapterContext) -> StageResult:
        source_csv = ctx.workspace.input_dir / "source.csv"
        out_dir = ctx.workspace.output_dir

        if self._is_raw_vayne_export(source_csv):
            # Raw Vayne export: emails/verification missing — run the real
            # pipeline with --skip-vayne so Icypeas + MillionVerifier execute.
            missing = [
                k
                for k in ("ICYPEAS_API_KEY", "ICYPEAS_USER_ID", "MILLIONVERIFIER_API_KEY")
                if not ctx.credentials.get(k)
            ]
            if missing:
                raise PermanentAdapterError(
                    f"CSV needs email discovery/verification but credentials are missing: {', '.join(missing)}"
                )
            name = slug(ctx.campaign_title)
            vayne_raw = out_dir / f"{name}_vayne_raw.csv"
            vayne_raw.write_bytes(source_csv.read_bytes())
            return self._invoke_pipeline(ctx, name, ["--skip-vayne"], out_dir)

        ctx.emit(
            "stage_progress",
            "CSV already carries verification columns — gating locally (no paid API calls)",
        )
        verified = ctx.workspace.safe_output_path("verified.csv")
        invalid = ctx.workspace.safe_output_path("invalid_emails.csv")
        counts = gate_csv(source_csv, verified, invalid)
        ctx.emit(
            "stage_progress",
            f"Gate complete: {counts['verified']} verified / {counts['invalid']} invalid / "
            f"{counts['catch_all']} catch-all / {counts['unknown']} unverified / {counts['duplicate']} duplicates",
            current_item=counts["total_submitted"],
            total_items=counts["total_submitted"],
        )
        if counts["verified"] == 0:
            raise PermanentAdapterError(
                "0 rows passed the verification gate. The canonical v1 CSV must contain "
                "verified emails (Status/quality/result columns)."
            )
        artifacts = [
            ArtifactOut(verified, "verified_csv", counts["verified"]),
            ArtifactOut(invalid, "invalid_email_csv", counts["invalid"] + counts["catch_all"] + counts["unknown"]),
        ]
        return StageResult(counts=counts, artifacts=artifacts)

    @staticmethod
    def _is_raw_vayne_export(path: Path) -> bool:
        """Raw Vayne 'simple' exports lack Icypeas/MV verification columns."""
        with path.open(encoding="utf-8-sig", newline="") as handle:
            headers = next(csv.reader(handle), [])
        normalized = {re.sub(r"[^a-z0-9]+", " ", h.casefold()).strip() for h in headers}
        verification_headers = {"status", "mv result", "mv quality", "quality", "result", "icypeas status", "email status"}
        return normalized.isdisjoint(verification_headers)

    # --------------------------------------------------- sales navigator path
    def _run_sales_navigator(self, ctx: AdapterContext, resume: bool) -> StageResult:
        missing = self.validate_credentials(ctx)
        if missing:
            raise PermanentAdapterError(f"Missing credentials on this runner: {', '.join(missing)}")
        name = slug(ctx.campaign_title)
        args_extra: list[str] = ["--url", str(ctx.source.get("url", ""))]
        limit = ctx.source.get("requested_limit")
        if limit:
            args_extra += ["--limit", str(int(limit))]
        return self._invoke_pipeline(ctx, name, args_extra, ctx.workspace.output_dir, url_mode=True)

    def _invoke_pipeline(
        self,
        ctx: AdapterContext,
        name: str,
        extra_args: list[str],
        out_dir: Path,
        url_mode: bool = False,
    ) -> StageResult:
        args = [python_executable(), str(self.pipeline_dir / "pipeline.py"), "--name", name, "--out", str(out_dir)]
        if url_mode:
            args += extra_args
        else:
            # csv --skip-vayne path: pipeline.py still requires --url; pass a
            # placeholder — the Vayne stage is skipped so it is never used.
            args += ["--url", "https://www.linkedin.com/sales/search/people", *extra_args]

        progress_re = re.compile(r"\[(\d+)/(\d+)\]")

        def handle_line(line: str) -> bool:
            match = progress_re.search(line)
            if match:
                ctx.emit(
                    "stage_progress",
                    line,
                    current_item=int(match.group(1)),
                    total_items=int(match.group(2)),
                )
                return True
            if line.startswith("ERROR") or "ERROR:" in line:
                ctx.emit("log", line, severity="error")
                return True
            return False

        code = run_streamed(ctx, args, cwd=self.pipeline_dir, line_handler=handle_line)
        if ctx.cancelled():
            raise AdapterError("Stage cancelled")
        if code != 0:
            raise AdapterError(f"Sourcing pipeline exited with code {code}")

        artifacts = self.collect_artifacts(ctx, name, out_dir)
        final = next((a for a in artifacts if a.artifact_type == "verified_csv"), None)
        raw = next((a for a in artifacts if a.artifact_type == "vayne_export"), None)
        counts = {
            "total_submitted": raw.row_count or 0 if raw else 0,
            "verified": final.row_count or 0 if final else 0,
        }
        if final is None:
            raise AdapterError("Pipeline finished but produced no final verified CSV")
        return StageResult(counts=counts, artifacts=artifacts)

    def collect_artifacts(self, ctx: AdapterContext, name: str | None = None, out_dir: Path | None = None) -> list[ArtifactOut]:  # type: ignore[override]
        name = name or slug(ctx.campaign_title)
        out_dir = out_dir or ctx.workspace.output_dir
        mapping = {
            f"{name}_vayne_raw.csv": "vayne_export",
            f"{name}_icypeas_results.csv": "email_discovery_output",
            f"{name}_combined.csv": "verification_output",
            f"{name}_mv_progress.csv": "verification_output",
            f"{name}_final.csv": "verified_csv",
        }
        artifacts = []
        for file_name, artifact_type in mapping.items():
            path = out_dir / file_name
            if path.is_file():
                artifacts.append(ArtifactOut(path, artifact_type, row_count=_csv_rows(path)))
        return artifacts


def _csv_rows(path: Path) -> int | None:
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            return max(0, sum(1 for _ in csv.reader(handle)) - 1)
    except OSError:
        return None
