"""Checkpoints, crash recovery, token storage, and workspace path safety."""
import json

import pytest

from aureli_runner.checkpoints import RunState, RunWorkspace, find_incomplete_runs
from aureli_runner.config import RunnerConfig, config_dir, delete_token, load_token, save_token


def test_state_roundtrip_is_atomic(workspace):
    state = RunState(run_id=workspace.root.name, stage="stage_two", stage_attempt=2, status="running")
    workspace.save_state(state)
    assert not (workspace.state_path.with_suffix(".tmp")).exists()
    loaded = workspace.load_state()
    assert loaded.stage == "stage_two"
    assert loaded.stage_attempt == 2


def test_corrupt_state_returns_none(workspace):
    workspace.state_path.write_text("{not json", encoding="utf-8")
    assert workspace.load_state() is None


def test_find_incomplete_runs_detects_interrupted_jobs(runner_home):
    ws1 = RunWorkspace("run-incomplete")
    ws1.save_state(RunState(run_id="run-incomplete", status="running"))
    ws2 = RunWorkspace("run-done")
    ws2.save_state(RunState(run_id="run-done", status="done"))
    assert find_incomplete_runs() == ["run-incomplete"]


def test_safe_output_path_blocks_traversal(workspace):
    ok = workspace.safe_output_path("verified.csv")
    assert ok.parent == workspace.output_dir.resolve() or ok.parent == workspace.output_dir
    with pytest.raises(ValueError):
        workspace.safe_output_path("..")
    escaped = workspace.safe_output_path("..\\..\\evil.csv")
    assert escaped.name == "evil.csv"
    assert str(workspace.output_dir.resolve()) in str(escaped)


def test_token_file_storage_roundtrip(runner_home):
    assert load_token() is None
    where = save_token("arn_" + "cd" * 32)
    assert where == "file"
    assert load_token() == "arn_" + "cd" * 32
    delete_token()
    assert load_token() is None


def test_config_roundtrip_and_no_secret_fields(runner_home):
    config = RunnerConfig(server_url="https://x.example", runner_id="r1", runner_name="PC")
    config.save()
    raw = json.loads((config_dir() / "config.json").read_text(encoding="utf-8"))
    assert "token" not in json.dumps(raw).lower()
    loaded = RunnerConfig.load()
    assert loaded.server_url == "https://x.example"
    assert loaded.runner_name == "PC"
