"""Vendor-neutral email-verification gating for already-enriched CSVs.

This mirrors the REAL gate in `GTM Scoring/gtm_research/pipeline/input.py`
(normalize_email_verification): MillionVerifier deliverability beats Icypeas
find-confidence beats a legacy percentage Status. It is used by the sourcing
adapter's CSV path to split an uploaded canonical CSV into verified /
catch-all / invalid buckets WITHOUT paid API calls (the canonical v1 upload is
already enriched + verified).
"""
from __future__ import annotations

import csv
import re
from pathlib import Path

_MV_RESULT_STATUS = {
    "ok": "VALID",
    "catch_all": "CATCH_ALL",
    "invalid": "INVALID",
    "bad": "INVALID",
    "disposable": "INVALID",
    "unknown": "UNKNOWN",
}
_MV_QUALITY_CONF = {"good": "HIGH", "risky": "LOW", "bad": "LOW"}
_ICYPEAS_CONF = {"ultra_sure": "HIGH", "probable": "MEDIUM", "guessed": "LOW", "valid": "HIGH"}
_LEGACY_VALID = {"99%", "95%", "verified", "valid"}


def _norm_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def _lookup(row: dict, *names: str) -> str:
    table = {_norm_header(str(k)): v for k, v in row.items() if k}
    for name in names:
        value = table.get(_norm_header(name))
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def classify_row(row: dict) -> tuple[str, str]:
    """Returns (status, provider): status in VALID/CATCH_ALL/INVALID/UNKNOWN."""
    mv_result = _lookup(row, "mv_result", "result").casefold()
    mv_quality = _lookup(row, "mv_quality", "quality").casefold()
    icypeas = _lookup(row, "icypeas_status").casefold()
    legacy = _lookup(row, "status", "email status", "email verification status", "verification status")
    if mv_result or mv_quality:
        status = _MV_RESULT_STATUS.get(mv_result, "UNKNOWN")
        confidence = _MV_QUALITY_CONF.get(mv_quality, "MEDIUM" if status == "VALID" else "UNKNOWN")
        if status == "VALID" and confidence in ("HIGH", "MEDIUM"):
            return "VALID", "MILLIONVERIFIER"
        return status if status != "VALID" else "UNKNOWN", "MILLIONVERIFIER"
    if icypeas:
        confidence = _ICYPEAS_CONF.get(icypeas, "UNKNOWN")
        return ("VALID" if confidence in ("HIGH", "MEDIUM") else "UNKNOWN"), "ICYPEAS"
    if legacy:
        return ("VALID" if legacy.casefold() in _LEGACY_VALID else "UNKNOWN"), "LEGACY"
    return "UNKNOWN", "UNKNOWN"


def gate_csv(
    source: Path,
    verified_out: Path,
    invalid_out: Path,
) -> dict[str, int]:
    """Split a canonical enriched CSV. Returns counts. Preserves all columns."""
    with source.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        rows = list(reader)

    email_field = next(
        (f for f in fieldnames if _norm_header(f) in ("email", "work email")), None
    )
    counts = {"total_submitted": len(rows), "verified": 0, "catch_all": 0, "invalid": 0, "unknown": 0, "duplicate": 0}
    seen_emails: set[str] = set()
    verified_rows, invalid_rows = [], []
    for row in rows:
        email = str(row.get(email_field, "") if email_field else "").strip().lower()
        if email and email in seen_emails:
            counts["duplicate"] += 1
            continue
        if email:
            seen_emails.add(email)
        status, _provider = classify_row(row)
        if status == "VALID":
            counts["verified"] += 1
            verified_rows.append(row)
        elif status == "CATCH_ALL":
            counts["catch_all"] += 1
            invalid_rows.append({**row, "aureli_gate_reason": "catch_all"})
        elif status == "INVALID":
            counts["invalid"] += 1
            invalid_rows.append({**row, "aureli_gate_reason": "invalid"})
        else:
            counts["unknown"] += 1
            invalid_rows.append({**row, "aureli_gate_reason": "no_verification_signal"})

    def write(path: Path, out_rows: list[dict], extra: list[str]) -> None:
        columns = fieldnames + [c for c in extra if c not in fieldnames]
        with path.open("w", encoding="utf-8-sig", newline="") as out:
            writer = csv.DictWriter(out, fieldnames=columns, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(out_rows)

    write(verified_out, verified_rows, [])
    write(invalid_out, invalid_rows, ["aureli_gate_reason"])
    return counts
