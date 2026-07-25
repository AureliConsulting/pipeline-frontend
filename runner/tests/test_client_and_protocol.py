"""Control-plane client behavior + cross-language protocol sync."""
import json
from pathlib import Path

import pytest

pytest.importorskip("responses")
import responses  # noqa: E402

from aureli_runner.client import ApiError, ControlPlaneClient  # noqa: E402
from aureli_runner.protocol import PROTOCOL, PROTOCOL_VERSION  # noqa: E402

BASE = "https://console.example"


def test_protocol_matches_shared_json():
    source = json.loads(
        (Path(__file__).resolve().parents[2] / "packages" / "shared" / "protocol.json").read_text(
            encoding="utf-8"
        )
    )
    assert PROTOCOL == source
    assert PROTOCOL_VERSION == source["protocol_version"]


@responses.activate
def test_pair_sends_protocol_version_and_returns_token():
    responses.add(
        responses.POST,
        f"{BASE}/api/runner/pair",
        json={"runner_id": "r1", "runner_name": "PC", "token": "arn_" + "aa" * 32},
        status=200,
    )
    client = ControlPlaneClient(BASE, token=None)
    result = client.pair("ABCD2345", "PC", "windows")
    body = json.loads(responses.calls[0].request.body)
    assert body["protocol_version"] == PROTOCOL_VERSION
    assert result["token"].startswith("arn_")


@responses.activate
def test_transient_500_is_retried_then_succeeds(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda *_: None)
    responses.add(responses.POST, f"{BASE}/api/runner/claim", json={"error": "boom"}, status=500)
    responses.add(responses.POST, f"{BASE}/api/runner/claim", json={"job": None}, status=200)
    client = ControlPlaneClient(BASE, token="arn_" + "aa" * 32)
    assert client.claim() is None
    assert len(responses.calls) == 2


@responses.activate
def test_permanent_401_is_not_retried(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda *_: None)
    responses.add(responses.POST, f"{BASE}/api/runner/claim", json={"error": "revoked"}, status=401)
    client = ControlPlaneClient(BASE, token="arn_" + "aa" * 32)
    with pytest.raises(ApiError) as excinfo:
        client.claim()
    assert excinfo.value.status == 401
    assert len(responses.calls) == 1


@responses.activate
def test_events_idempotent_batch_shape():
    captured = {}

    def callback(request):
        captured.update(json.loads(request.body))
        return (200, {}, json.dumps({"ok": True, "inserted": 2}))

    responses.add_callback(responses.POST, f"{BASE}/api/runner/runs/RID/events", callback=callback)
    client = ControlPlaneClient(BASE, token="arn_" + "aa" * 32)
    events = [
        {"seq": 0, "stage": "stage_one", "ts": "2026-07-24T00:00:00+00:00", "severity": "info", "event_type": "log", "message": "a"},
        {"seq": 1, "stage": "stage_one", "ts": "2026-07-24T00:00:01+00:00", "severity": "info", "event_type": "log", "message": "b"},
    ]
    client.post_events("RID", events)
    assert [e["seq"] for e in captured["events"]] == [0, 1]
