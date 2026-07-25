"""Vendor-priority verification gate (mirrors gtm_research input rules)."""
import csv
from pathlib import Path

from aureli_runner.adapters.csv_gate import classify_row, gate_csv

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "sample_leads.csv"


def test_classify_prefers_millionverifier_over_legacy():
    assert classify_row({"result": "ok", "quality": "good", "Status": "0%"}) == ("VALID", "MILLIONVERIFIER")
    assert classify_row({"result": "catch_all", "quality": "risky"})[0] == "CATCH_ALL"
    assert classify_row({"result": "invalid", "quality": "bad"})[0] == "INVALID"


def test_classify_falls_back_to_icypeas_then_legacy():
    assert classify_row({"icypeas_status": "ultra_sure"}) == ("VALID", "ICYPEAS")
    assert classify_row({"icypeas_status": "guessed"})[0] == "UNKNOWN"
    assert classify_row({"Status": "99%"}) == ("VALID", "LEGACY")
    assert classify_row({"Status": "10%"})[0] == "UNKNOWN"
    assert classify_row({})[0] == "UNKNOWN"


def test_gate_fixture_counts_reconcile(tmp_path):
    verified = tmp_path / "verified.csv"
    invalid = tmp_path / "invalid.csv"
    counts = gate_csv(FIXTURE, verified, invalid)
    assert counts["total_submitted"] == 6
    assert counts["duplicate"] == 1  # jordan repeated
    routed = counts["verified"] + counts["catch_all"] + counts["invalid"] + counts["unknown"]
    assert routed + counts["duplicate"] == counts["total_submitted"]
    assert counts["verified"] == 3  # avery, jordan, morgan (sam is catch_all, riley no email)
    with verified.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert {r["first name"] for r in rows} == {"Avery", "Jordan", "Morgan"}
    with invalid.open(encoding="utf-8-sig", newline="") as handle:
        invalid_rows = list(csv.DictReader(handle))
    assert all(r.get("aureli_gate_reason") for r in invalid_rows)
