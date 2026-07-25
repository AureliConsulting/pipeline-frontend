"""Retry policy + secret redaction — vectors pinned to match the TS tests."""
from aureli_runner.redact import redact, redact_url
from aureli_runner.retry import classify_error, next_retry


def test_classification_permanent():
    assert classify_error("Invalid API key supplied") == "permanent"
    assert classify_error("401 unauthorized") == "permanent"
    assert classify_error("Invalid YAML: mapping expected") == "permanent"
    assert classify_error("missing required column: email") == "permanent"
    assert classify_error("anything", 422) == "permanent"


def test_classification_transient_and_default():
    assert classify_error("connection reset by peer") == "transient"
    assert classify_error("Too Many Requests") == "transient"
    assert classify_error("anything", 503) == "transient"
    assert classify_error("weird unknown failure") == "transient"


def test_backoff_vectors_match_shared_ts():
    mid = lambda: 0.5  # noqa: E731 — zero jitter
    assert next_retry(1, "transient", mid).retry is True
    assert next_retry(3, "transient", mid).retry is False
    assert next_retry(1, "permanent", mid).retry is False
    assert next_retry(1, "transient", mid).delay_seconds == 5
    assert next_retry(2, "transient", mid).delay_seconds == 10
    assert abs(next_retry(1, "transient", lambda: 1.0).delay_seconds - 6.3) < 0.11
    assert abs(next_retry(1, "transient", lambda: 0.0).delay_seconds - 3.8) < 0.11


def test_redaction_covers_env_keys_bearer_and_runner_tokens():
    assert "supersecret" not in redact("EXA_API_KEY=supersecret123")
    assert "[redacted]" in redact("Authorization: Bearer abcdef.ghijkl.mnopqr")
    token = "arn_" + "ab" * 32
    assert token not in redact(f"claim with {token}")
    assert "sk-abcdefghijklmnop1234" not in redact("using sk-abcdefghijklmnop1234")


def test_redaction_of_known_values_and_urls():
    assert "actualvalue" not in redact("output actualvalue here", ["actualvalue"])
    assert redact_url("https://x.example/file.csv?token=SECRET") == "https://x.example/file.csv?…"


def test_normal_text_untouched():
    assert redact("Processed 10/100 leads") == "Processed 10/100 leads"
