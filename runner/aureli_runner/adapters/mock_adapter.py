"""Mock adapter — full workflow without paid APIs.

Processes the run's source CSV (or a bundled fixture for Sales Navigator
mocks), simulates realistic stage progress, emits logs, exercises a transient
retry and a partial row failure, produces real downloadable artifacts, and
pauses at both approval points (pausing is driven by the server's state
machine — this adapter just completes its stage).

Guarantee: this module performs NO network calls to any pipeline provider.
"""
from __future__ import annotations

import csv
import json
import time
from pathlib import Path

from .base import AdapterContext, ArtifactOut, PipelineAdapter, StageResult

FIXTURE_ROWS = [
    {
        "first name": "Avery", "last name": "Chen", "email": "avery@acme-msp.example",
        "company": "Acme MSP", "corporate website": "https://acme-msp.example",
        "job title": "Founder", "Status": "99%", "quality": "good", "result": "ok",
        "linkedin employees": "40",
    },
    {
        "first name": "Jordan", "last name": "Lee", "email": "jordan@nimbusit.example",
        "company": "Nimbus IT", "corporate website": "https://nimbusit.example",
        "job title": "CEO", "Status": "95%", "quality": "good", "result": "ok",
        "linkedin employees": "85",
    },
    {
        "first name": "Sam", "last name": "Ortiz", "email": "sam@brightstack.example",
        "company": "BrightStack", "corporate website": "https://brightstack.example",
        "job title": "COO", "Status": "95%", "quality": "risky", "result": "catch_all",
        "linkedin employees": "120",
    },
    {
        "first name": "Riley", "last name": "Novak", "email": "",
        "company": "Cobalt Networks", "corporate website": "https://cobaltnet.example",
        "job title": "CTO", "Status": "", "quality": "", "result": "",
        "linkedin employees": "60",
    },
]


class MockPipelineAdapter(PipelineAdapter):
    name = "mock"

    def _sleep(self, ctx: AdapterContext, seconds: float) -> None:
        if ctx.mock_fast:
            return
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if ctx.cancelled():
                return
            time.sleep(min(0.2, end - time.monotonic()))

    def _load_rows(self, ctx: AdapterContext) -> list[dict[str, str]]:
        source_csv = ctx.workspace.input_dir / "source.csv"
        if source_csv.is_file():
            with source_csv.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            if rows:
                return rows
        return [dict(row) for row in FIXTURE_ROWS]

    @staticmethod
    def _write_csv(path: Path, rows: list[dict], columns: list[str] | None = None) -> None:
        if not rows:
            path.write_text("", encoding="utf-8")
            return
        columns = columns or list({key for row in rows for key in row})
        with path.open("w", encoding="utf-8-sig", newline="") as out:
            writer = csv.DictWriter(out, fieldnames=columns, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)

    # ------------------------------------------------------------ stage one
    def start_stage(self, ctx: AdapterContext) -> StageResult:
        if ctx.stage == "stage_two":
            return self._stage_two(ctx)
        if ctx.stage == "fallback_resolver":
            return self._fallback_resolver(ctx)
        return self._stage_one(ctx)

    def _stage_one(self, ctx: AdapterContext) -> StageResult:
        rows = self._load_rows(ctx)
        total = len(rows)
        ctx.emit("stage_progress", f"[MOCK] Sourcing {total} leads (no paid APIs)", total_items=total, current_item=0)
        verified, invalid = [], []
        retried = 0
        for index, row in enumerate(rows, 1):
            if ctx.cancelled():
                raise RuntimeError("Stage cancelled")
            self._sleep(ctx, 0.4)
            # Simulate one transient hiccup + retry on the second row.
            if index == 2 and retried == 0 and str(ctx.directive.get("mode", "")) != "retry_failed":
                retried = 1
                ctx.emit(
                    "stage_retrying",
                    "[MOCK] Transient timeout from verification provider — retrying with backoff",
                    severity="warn",
                    retry_count=1,
                )
                self._sleep(ctx, 0.6)
                ctx.emit("stage_started", "[MOCK] Retry succeeded, continuing", retry_count=1)
            email = (row.get("email") or row.get("Email") or "").strip()
            quality = (row.get("quality") or "").strip().lower()
            status = (row.get("Status") or "").strip()
            if email and (quality == "good" or status in ("99%", "95%")):
                verified.append(row)
            else:
                invalid.append({**row, "aureli_gate_reason": "no_verified_email"})
            ctx.emit(
                "stage_progress",
                f"[MOCK] Processed {email or row.get('company', 'row')} ",
                current_item=index,
                total_items=total,
            )
        verified_path = ctx.workspace.safe_output_path("verified.csv")
        invalid_path = ctx.workspace.safe_output_path("invalid_emails.csv")
        log_path = ctx.workspace.safe_output_path("stage_one_log.txt")
        self._write_csv(verified_path, verified)
        self._write_csv(invalid_path, invalid)
        log_path.write_text("[MOCK] stage one complete — fixture log\n", encoding="utf-8")
        counts = {
            "total_submitted": total,
            "discovered": total - sum(1 for r in rows if not (r.get("email") or r.get("Email"))),
            "verified": len(verified),
            "invalid": len(invalid),
            "catch_all": sum(1 for r in rows if (r.get("result") or "").lower() == "catch_all"),
            "duplicate": 0,
            "failed": 1 if str(ctx.directive.get("mode", "")) != "skip_failed" and not any(
                r.get("email") for r in rows
            ) else 0,
            "retried": retried,
        }
        return StageResult(
            counts=counts,
            artifacts=[
                ArtifactOut(verified_path, "verified_csv", len(verified)),
                ArtifactOut(invalid_path, "invalid_email_csv", len(invalid)),
                ArtifactOut(log_path, "pipeline_log", None),
            ],
            warnings=(["[MOCK] 1 row had no email and was routed to the invalid list"] if invalid else []),
        )

    # ------------------------------------------------------------ stage two
    def _stage_two(self, ctx: AdapterContext) -> StageResult:
        verified_path = ctx.workspace.output_dir / "verified.csv"
        rows: list[dict[str, str]] = []
        if verified_path.is_file():
            with verified_path.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
        if not rows:
            rows = [dict(row) for row in FIXTURE_ROWS[:2]]
        total = len(rows)
        ctx.emit("stage_progress", f"[MOCK] Scoring {total} companies", total_items=total, current_item=0)

        scored, personalized, manual = [], [], []
        exa_queries = 0
        for index, row in enumerate(rows, 1):
            if ctx.cancelled():
                raise RuntimeError("Stage cancelled")
            self._sleep(ctx, 0.5)
            exa_queries += 3
            if index == 1:
                ctx.emit(
                    "stage_retrying",
                    "[MOCK] DeepSeek rate limit — automatic retry 1/3",
                    severity="warn",
                    retry_count=1,
                )
                self._sleep(ctx, 0.4)
                ctx.emit("stage_started", "[MOCK] Retry succeeded")
            score = 82 - index * 7
            decision = "Yes" if score >= 70 else "Review"
            scored_row = {
                **row,
                "opportunity_score": str(score),
                "operational_decision": "OUTREACH_NOW" if decision == "Yes" else "MANUAL_REVIEW",
                "outreach_decision": decision,
            }
            scored.append(scored_row)
            if decision == "Yes":
                personalized.append(
                    {
                        **scored_row,
                        "gtm_trigger_short": "hiring two AE roles this quarter",
                        "risk_reversal_offer": "build the first campaign and target-account list with no upfront fee",
                        "contact_bridge": "Not sure if outbound is a priority right now",
                        "send_eligible": "true",
                    }
                )
            else:
                manual.append(scored_row)
            ctx.emit(
                "stage_progress",
                f"[MOCK] Scored {row.get('company', 'company')} = {score}",
                current_item=index,
                total_items=total,
                exa_query_count=exa_queries,
                cost_usd=round(0.011 * index, 3),
            )

        out = ctx.workspace.safe_output_path
        paths = {
            "gtm_scored_csv": out("mock_scored_final.csv"),
            "personalized_csv": out("mock_personalized_final.csv"),
            "instantly_ready_csv": out("mock_send_ready.csv"),
            "manual_review_csv": out("mock_manual_review.csv"),
            "rejected_csv": out("mock_rejected.csv"),
            "cost_report": out("mock_cost_report.json"),
            "pipeline_log": out("stage_two_log.txt"),
        }
        self._write_csv(paths["gtm_scored_csv"], scored)
        self._write_csv(paths["personalized_csv"], personalized + manual)
        self._write_csv(paths["instantly_ready_csv"], personalized)
        self._write_csv(paths["manual_review_csv"], manual)
        self._write_csv(paths["rejected_csv"], [])
        paths["cost_report"].write_text(
            json.dumps(
                {
                    "mock": True,
                    "exa_requests": exa_queries,
                    "estimated_exa_cost_usd": round(exa_queries * 0.0035, 4),
                    "deepseek_tokens": 12_000 * total,
                    "note": "Fixture cost report — no real spend occurred.",
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        paths["pipeline_log"].write_text("[MOCK] stage two complete — fixture log\n", encoding="utf-8")

        counts = {
            "scored": len(scored),
            "personalized": len(personalized) + len(manual),
            "send_ready": len(personalized),
            "manual_review": len(manual),
            "successful": len(scored),
            "failed": 0,
        }
        artifacts = [
            ArtifactOut(paths["gtm_scored_csv"], "gtm_scored_csv", len(scored)),
            ArtifactOut(paths["personalized_csv"], "personalized_csv", len(personalized) + len(manual)),
            ArtifactOut(paths["instantly_ready_csv"], "instantly_ready_csv", len(personalized)),
            ArtifactOut(paths["manual_review_csv"], "manual_review_csv", len(manual)),
            ArtifactOut(paths["rejected_csv"], "rejected_csv", 0),
            ArtifactOut(paths["cost_report"], "cost_report", None),
            ArtifactOut(paths["pipeline_log"], "pipeline_log", None),
        ]
        return StageResult(counts=counts, artifacts=artifacts)

    # ------------------------------------------------------- fallback resolver
    def _fallback_resolver(self, ctx: AdapterContext) -> StageResult:
        personalized_path = ctx.workspace.output_dir / "mock_personalized_final.csv"
        rows: list[dict[str, str]] = []
        if personalized_path.is_file():
            with personalized_path.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
        if not rows:
            rows = [dict(row) for row in FIXTURE_ROWS[:2]]
        total = len(rows)
        allow_partial = bool(ctx.directive.get("allow_partial"))
        ctx.emit("stage_progress", f"[MOCK] Resolving fallbacks for {total} leads", total_items=total, current_item=0)

        ready, blocked, audit = [], [], []
        remediated = 0
        for index, row in enumerate(rows, 1):
            if ctx.cancelled():
                raise RuntimeError("Stage cancelled")
            self._sleep(ctx, 0.2)
            email = (row.get("email") or "").strip()
            first_name = (row.get("first name") or row.get("first_name") or "").strip()
            fallback_applied = not first_name
            resolved_name = first_name or (email.split("@")[0].capitalize() if email else "there")
            if fallback_applied:
                remediated += 1
                audit.append(
                    {
                        "campaign_key": "mock_campaign",
                        "campaign_config_hash": "sha256:mock",
                        "row_number": str(index + 1),
                        "email": email,
                        "field": "first_name",
                        "internal_field": "first_name",
                        "output_field": "first_name",
                        "old_value": first_name,
                        "new_value": resolved_name,
                        "rule_type": "email_local_part",
                        "rule_index": "0",
                    }
                )
            # Deterministically quarantine the last row so mock runs always
            # exercise the blocked-review + partial-mode UI paths.
            if index == total and not email:
                blocked.append(
                    {
                        **row,
                        "first_name": resolved_name,
                        "automation_status": "BLOCKED",
                        "fallback_applied": str(fallback_applied).lower(),
                        "fallback_fields": "first_name" if fallback_applied else "",
                        "validation_errors": "missing_required:email",
                    }
                )
            else:
                ready.append(
                    {
                        "email": email,
                        "first_name": resolved_name,
                        "automation_status": "READY_FALLBACK" if fallback_applied else "READY",
                        "fallback_applied": str(fallback_applied).lower(),
                        "fallback_fields": "first_name" if fallback_applied else "",
                        "validation_errors": "",
                    }
                )
            ctx.emit("stage_progress", f"[MOCK] Resolved {email or 'row'}", current_item=index, total_items=total)

        out = ctx.workspace.safe_output_path
        ready_path = out("ready_to_push.csv")
        blocked_path = out("blocked_for_review.csv")
        audit_path = out("fallback_audit.csv")
        summary_path = out("run_summary.json")
        self._write_csv(
            ready_path, ready,
            ["email", "first_name", "automation_status", "fallback_applied", "fallback_fields", "validation_errors"],
        )
        self._write_csv(blocked_path, blocked)
        self._write_csv(
            audit_path, audit,
            ["campaign_key", "campaign_config_hash", "row_number", "email", "field", "internal_field",
             "output_field", "old_value", "new_value", "rule_type", "rule_index"],
        )
        summary = {
            "input_file": "[MOCK] mock_personalized_final.csv",
            "input_rows": total,
            "targeted_rows": remediated,
            "remediated_rows": remediated,
            "ready_rows": len(ready),
            "blocked_rows": len(blocked),
            "fallback_changes": len(audit),
            "blocked_reason_counts": ({"missing_required": len(blocked)} if blocked else {}),
            "campaign_key": "mock_campaign",
            "campaign_name": "[MOCK] campaign",
            "campaign_config": None,
            "campaign_config_hash": "sha256:mock",
            "required_variables": ["email"],
            "optional_variables": ["first_name"],
            "template_steps_validated": 1,
            "instantly_variable_mapping": {"first_name": "first_name"},
            "partial_mode": allow_partial,
            "outputs": {
                "ready_to_push": str(ready_path),
                "blocked_for_review": str(blocked_path),
                "fallback_audit": str(audit_path),
            },
        }
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

        counts = {
            "input_rows": total,
            "targeted_rows": remediated,
            "remediated_rows": remediated,
            "ready_rows": len(ready),
            "blocked_rows": len(blocked),
            "fallback_changes": len(audit),
        }
        warnings = (
            [f"[MOCK] {len(blocked)} lead(s) blocked for manual review" + ("" if allow_partial else " (partial mode was off)")]
            if blocked else []
        )
        artifacts = [
            ArtifactOut(ready_path, "ready_to_push_csv", len(ready)),
            ArtifactOut(blocked_path, "blocked_for_review_csv", len(blocked)),
            ArtifactOut(audit_path, "fallback_audit_csv", len(audit)),
            ArtifactOut(summary_path, "run_summary_json", None),
        ]
        return StageResult(counts=counts, artifacts=artifacts, warnings=warnings)

    # ------------------------------------------------------------- instantly
    def instantly_upload(self, ctx: AdapterContext, lead_count: int) -> int:
        ctx.emit("instantly_upload_started", f"[MOCK] Uploading {lead_count} leads to Instantly (fake)")
        self._sleep(ctx, 1.0)
        ctx.emit("instantly_upload_completed", f"[MOCK] Upload of {lead_count} leads acknowledged (fake)")
        return lead_count
