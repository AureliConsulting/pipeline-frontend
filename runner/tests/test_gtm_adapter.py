"""GTM adapter campaign-config dispatch regression coverage."""
from pathlib import Path

import pytest

from aureli_runner.adapters.base import PermanentAdapterError
from aureli_runner.adapters.gtm_adapter import GtmScoringPersonalizationAdapter
from aureli_runner.jobs import RunnerDaemon


YAML_TEXT = """campaign_id: test-campaign
name: \"Test campaign\"
emails:
  - id: \"email_1\"
    sequence_position: 1
    body: \"Hello {{firstname}}\"
variables:
  firstname:
    type: \"source\"
    source_column: \"first_name\"
"""


def test_campaign_config_path_preserves_materialized_yaml_bytes(ctx_factory, workspace):
    config_path = workspace.input_dir / "campaign_config.yaml"
    config_path.write_bytes(YAML_TEXT.encode("utf-8"))
    ctx, _ = ctx_factory(stage="stage_two")

    resolved = GtmScoringPersonalizationAdapter._campaign_config_path(ctx)

    assert resolved.suffix == ".yaml"
    assert resolved.read_bytes() == YAML_TEXT.encode("utf-8")


def test_personalize_invocation_uses_yaml_campaign_config(ctx_factory, workspace, monkeypatch, tmp_path):
    gtm_dir = tmp_path / "gtm-scoring"
    (gtm_dir / "gtm_research").mkdir(parents=True)
    (gtm_dir / "gtm_research" / "__main__.py").touch()
    (workspace.output_dir / "verified.csv").write_text("company\nAcme\n", encoding="utf-8")
    (workspace.input_dir / "campaign_config.yaml").write_text(YAML_TEXT, encoding="utf-8")
    ctx, _ = ctx_factory(stage="stage_two")
    ctx.credentials = {"EXA_API_KEY": "test", "DEEPSEEK_API_KEY": "test"}
    captured: list[list[str]] = []

    def fake_run_streamed(_ctx, args, **_kwargs):
        captured.append(args)
        if args[3] == "run":
            (workspace.output_dir / "verified_scored_final.csv").write_text("company\nAcme\n", encoding="utf-8")
        elif args[3] == "personalize":
            for name in (
                "verified_personalized_final.csv",
                "verified_send_ready.csv",
                "verified_manual_review.csv",
            ):
                (workspace.output_dir / name).write_text("company\nAcme\n", encoding="utf-8")
        return 0

    monkeypatch.setattr("aureli_runner.adapters.gtm_adapter.run_streamed", fake_run_streamed)

    GtmScoringPersonalizationAdapter(gtm_dir).start_stage(ctx)

    personalize_args = next(args for args in captured if args[3] == "personalize")
    campaign_config = personalize_args[personalize_args.index("--campaign-config") + 1]
    assert Path(campaign_config).suffix in {".yaml", ".yml"}
    assert not campaign_config.endswith(".json")


def test_materialize_inputs_writes_only_verbatim_yaml(workspace):
    daemon = object.__new__(RunnerDaemon)

    daemon._materialize_inputs(
        workspace,
        {
            "config": {
                "yaml_text": YAML_TEXT,
                "normalized_json": {"campaign_id": "test-campaign"},
            }
        },
    )

    assert (workspace.input_dir / "campaign_config.yaml").read_bytes() == YAML_TEXT.encode("utf-8")
    assert not (workspace.input_dir / "campaign_config.json").exists()


def test_campaign_config_path_requires_materialized_yaml(ctx_factory):
    ctx, _ = ctx_factory(stage="stage_two")

    with pytest.raises(PermanentAdapterError, match="Campaign configuration was not materialized"):
        GtmScoringPersonalizationAdapter._campaign_config_path(ctx)
