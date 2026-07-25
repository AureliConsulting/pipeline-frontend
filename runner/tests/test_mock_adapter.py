"""Mock adapter end-to-end (offline): stage one + two, retries, artifacts."""
import shutil
import socket
from pathlib import Path

import pytest

from aureli_runner.adapters.mock_adapter import MockPipelineAdapter

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "sample_leads.csv"


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Mock mode must NEVER touch the network."""

    def blocked(*args, **kwargs):
        raise AssertionError("Mock adapter attempted a network call")

    monkeypatch.setattr(socket.socket, "connect", blocked)


def test_stage_one_processes_fixture_and_simulates_retry(ctx_factory, workspace):
    shutil.copy(FIXTURE, workspace.input_dir / "source.csv")
    ctx, emitter = ctx_factory(stage="stage_one")
    result = MockPipelineAdapter().start_stage(ctx)

    assert result.counts["total_submitted"] == 6
    assert result.counts["verified"] >= 3
    assert result.counts["retried"] == 1
    types = {a.artifact_type for a in result.artifacts}
    assert {"verified_csv", "invalid_email_csv", "pipeline_log"} <= types
    for artifact in result.artifacts:
        assert artifact.path.is_file()
    event_types = [e["event_type"] for e in emitter.events]
    assert "stage_retrying" in event_types  # exercises the retry path
    assert any(e.get("total_items") == 6 for e in emitter.events)


def test_stage_two_produces_full_artifact_set(ctx_factory, workspace):
    shutil.copy(FIXTURE, workspace.input_dir / "source.csv")
    ctx1, _ = ctx_factory(stage="stage_one")
    MockPipelineAdapter().start_stage(ctx1)

    ctx2, emitter = ctx_factory(stage="stage_two")
    result = MockPipelineAdapter().start_stage(ctx2)
    types = {a.artifact_type for a in result.artifacts}
    assert {
        "gtm_scored_csv",
        "personalized_csv",
        "instantly_ready_csv",
        "manual_review_csv",
        "cost_report",
    } <= types
    assert result.counts["scored"] > 0
    assert result.counts["send_ready"] + result.counts["manual_review"] == result.counts["scored"]
    assert any(e.get("exa_query_count") for e in emitter.events)
    assert any(e.get("cost_usd") for e in emitter.events)


def test_mock_instantly_upload_is_labeled_fake(ctx_factory):
    ctx, emitter = ctx_factory(stage="instantly_upload")
    uploaded = MockPipelineAdapter().instantly_upload(ctx, 5)
    assert uploaded == 5
    assert all("MOCK" in e["message"] for e in emitter.events)


def test_cancellation_stops_stage(ctx_factory, workspace):
    shutil.copy(FIXTURE, workspace.input_dir / "source.csv")
    ctx, _ = ctx_factory(stage="stage_one")
    ctx.cancel_event.set()
    with pytest.raises(RuntimeError, match="cancelled"):
        MockPipelineAdapter().start_stage(ctx)
