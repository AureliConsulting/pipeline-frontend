"""Fallback resolver adapter — exit-code semantics and flag threading."""
import json
from pathlib import Path

import pytest

from aureli_runner.adapters.base import AdapterError, PermanentAdapterError
from aureli_runner.adapters.fallback_resolver_adapter import FallbackResolverAdapter

YAML_TEXT = "campaign_id: test-campaign\nname: \"Test campaign\"\n"


def _write_summary(workspace, **overrides):
    summary = {
        "input_rows": 3,
        "targeted_rows": 1,
        "remediated_rows": 1,
        "ready_rows": 2,
        "blocked_rows": 1,
        "fallback_changes": 1,
        "blocked_reason_counts": {"missing_required": 1},
        "campaign_key": "test-campaign",
        "campaign_name": "Test campaign",
        "campaign_config_hash": "sha256:abc",
        "partial_mode": False,
        **overrides,
    }
    (workspace.output_dir / "run_summary.json").write_text(json.dumps(summary), encoding="utf-8")
    return summary


def _make_gtm_dir(tmp_path) -> Path:
    gtm_dir = tmp_path / "gtm-scoring"
    (gtm_dir / "gtm_research").mkdir(parents=True)
    (gtm_dir / "gtm_research" / "__main__.py").touch()
    return gtm_dir


def _prepare_workspace(workspace):
    (workspace.output_dir / "leads_personalized_final.csv").write_text("email\na@b.com\n", encoding="utf-8")
    (workspace.input_dir / "campaign_config.yaml").write_text(YAML_TEXT, encoding="utf-8")


def test_exit_code_2_is_not_an_error(ctx_factory, workspace, monkeypatch, tmp_path):
    gtm_dir = _make_gtm_dir(tmp_path)
    _prepare_workspace(workspace)
    ctx, _ = ctx_factory(stage="fallback_resolver")

    def fake_run_streamed(_ctx, args, **_kwargs):
        _write_summary(workspace)
        for name in ("ready_to_push.csv", "blocked_for_review.csv", "fallback_audit.csv"):
            (workspace.output_dir / name).write_text("email\n", encoding="utf-8")
        return 2

    monkeypatch.setattr("aureli_runner.adapters.fallback_resolver_adapter.run_streamed", fake_run_streamed)

    result = FallbackResolverAdapter(gtm_dir).start_stage(ctx)

    assert result.counts["blocked_rows"] == 1
    assert result.counts["ready_rows"] == 2
    assert any("blocked" in w for w in result.warnings)


def test_nonzero_nontwo_exit_raises_adapter_error(ctx_factory, workspace, monkeypatch, tmp_path):
    gtm_dir = _make_gtm_dir(tmp_path)
    _prepare_workspace(workspace)
    ctx, _ = ctx_factory(stage="fallback_resolver")
    monkeypatch.setattr(
        "aureli_runner.adapters.fallback_resolver_adapter.run_streamed", lambda *a, **k: 1
    )

    with pytest.raises(AdapterError):
        FallbackResolverAdapter(gtm_dir).start_stage(ctx)


def test_allow_partial_and_config_flags_threaded_only_when_present(ctx_factory, workspace, monkeypatch, tmp_path):
    gtm_dir = _make_gtm_dir(tmp_path)
    _prepare_workspace(workspace)
    ctx, _ = ctx_factory(stage="fallback_resolver", directive={"allow_partial": True})
    captured: list[list[str]] = []

    def fake_run_streamed(_ctx, args, **_kwargs):
        captured.append(args)
        _write_summary(workspace, blocked_rows=0, ready_rows=3)
        for name in ("ready_to_push.csv", "blocked_for_review.csv", "fallback_audit.csv"):
            (workspace.output_dir / name).write_text("email\n", encoding="utf-8")
        return 0

    monkeypatch.setattr("aureli_runner.adapters.fallback_resolver_adapter.run_streamed", fake_run_streamed)

    FallbackResolverAdapter(gtm_dir).start_stage(ctx)

    args = captured[0]
    assert "--allow-partial" in args
    assert "--config" not in args  # no fallback_rules.json materialized in this workspace


def test_config_flag_present_when_rules_materialized(ctx_factory, workspace, monkeypatch, tmp_path):
    gtm_dir = _make_gtm_dir(tmp_path)
    _prepare_workspace(workspace)
    (workspace.input_dir / "fallback_rules.json").write_text("{}", encoding="utf-8")
    ctx, _ = ctx_factory(stage="fallback_resolver")
    captured: list[list[str]] = []

    def fake_run_streamed(_ctx, args, **_kwargs):
        captured.append(args)
        _write_summary(workspace, blocked_rows=0, ready_rows=3)
        for name in ("ready_to_push.csv", "blocked_for_review.csv", "fallback_audit.csv"):
            (workspace.output_dir / name).write_text("email\n", encoding="utf-8")
        return 0

    monkeypatch.setattr("aureli_runner.adapters.fallback_resolver_adapter.run_streamed", fake_run_streamed)

    FallbackResolverAdapter(gtm_dir).start_stage(ctx)

    args = captured[0]
    assert "--config" in args
    assert args[args.index("--config") + 1].endswith("fallback_rules.json")


def test_missing_campaign_config_raises_permanent_error(ctx_factory, workspace, tmp_path):
    gtm_dir = _make_gtm_dir(tmp_path)
    (workspace.output_dir / "leads_personalized_final.csv").write_text("email\na@b.com\n", encoding="utf-8")
    ctx, _ = ctx_factory(stage="fallback_resolver")

    with pytest.raises(PermanentAdapterError):
        FallbackResolverAdapter(gtm_dir).start_stage(ctx)


def test_collect_artifacts_maps_all_four_output_types(ctx_factory, workspace):
    _write_summary(workspace)
    for name in ("ready_to_push.csv", "blocked_for_review.csv", "fallback_audit.csv"):
        (workspace.output_dir / name).write_text("email\na@b.com\n", encoding="utf-8")
    ctx, _ = ctx_factory(stage="fallback_resolver")

    artifacts = FallbackResolverAdapter(workspace.root).collect_artifacts(ctx)

    types = {a.artifact_type for a in artifacts}
    assert types == {"ready_to_push_csv", "blocked_for_review_csv", "fallback_audit_csv", "run_summary_json"}
