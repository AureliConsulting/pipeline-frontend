import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def runner_home(tmp_path, monkeypatch):
    home = tmp_path / "runner-home"
    monkeypatch.setenv("AURELI_RUNNER_HOME", str(home))
    return home


@pytest.fixture
def workspace(runner_home):
    from aureli_runner.checkpoints import RunWorkspace

    return RunWorkspace("11111111-1111-4111-8111-111111111111")


class FakeEmitter:
    def __init__(self):
        self.events = []

    def __call__(self, event_type, message, severity="info", **fields):
        self.events.append({"event_type": event_type, "message": message, "severity": severity, **fields})


@pytest.fixture
def ctx_factory(workspace):
    from aureli_runner.adapters.base import AdapterContext

    def make(stage="stage_one", source=None, mock_fast=True, directive=None):
        emitter = FakeEmitter()
        context = AdapterContext(
            run_id=workspace.root.name,
            stage=stage,
            workspace=workspace,
            campaign_title="Test Campaign",
            source=source or {"type": "csv"},
            config_yaml="campaign_id: test",
            config_json={"campaign_id": "test"},
            directive=directive or {},
            credentials={},
            emit=emitter,
            cancel_event=threading.Event(),
            mock_fast=mock_fast,
        )
        return context, emitter

    return make
