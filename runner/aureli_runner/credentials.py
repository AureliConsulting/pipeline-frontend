"""Local credential detection & connection tests.

Credentials are read from a local .env file with python-dotenv (or the process
environment). ONLY statuses — configured / missing / invalid / unchecked —
ever leave this machine. Values are never logged, transmitted, or stored
anywhere but the local .env / OS keychain.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import dotenv_values

from .config import RunnerConfig
from .protocol import CREDENTIAL_KEYS

ALL_KEYS: list[str] = [
    *CREDENTIAL_KEYS["stage_one"],
    *CREDENTIAL_KEYS["stage_two"],
    *CREDENTIAL_KEYS["instantly_upload"],
]


def _candidate_env_files(config: RunnerConfig) -> list[Path]:
    candidates: list[Path] = []
    if config.env_file:
        candidates.append(Path(config.env_file))
    if config.sourcing_pipeline_dir:
        candidates.append(Path(config.sourcing_pipeline_dir) / "API_keys.env")
        candidates.append(Path(config.sourcing_pipeline_dir) / ".env")
    if config.gtm_dir:
        candidates.append(Path(config.gtm_dir) / ".env")
    candidates.append(Path.cwd() / ".env")
    return candidates


def load_credentials(config: RunnerConfig) -> dict[str, str]:
    """Merged view: process env wins, then the first file that defines a key."""
    merged: dict[str, str] = {}
    for path in reversed(_candidate_env_files(config)):
        if path.is_file():
            for key, value in (dotenv_values(path) or {}).items():
                if key and value:
                    merged[key] = value
    for key in ALL_KEYS:
        env_value = os.environ.get(key)
        if env_value:
            merged[key] = env_value
    return merged


def detect_statuses(config: RunnerConfig, invalid_keys: set[str] | None = None) -> dict[str, str]:
    values = load_credentials(config)
    statuses: dict[str, str] = {}
    for key in ALL_KEYS:
        if invalid_keys and key in invalid_keys:
            statuses[key] = "invalid"
        elif values.get(key):
            statuses[key] = "configured"
        else:
            statuses[key] = "missing"
    return statuses


def connection_tests(config: RunnerConfig) -> tuple[dict[str, str], str]:
    """Cheap, read-only validity checks per provider. Only run on demand
    (`aureli-runner check-credentials`) — never automatically, so no surprise
    API usage. Returns (statuses, iso_timestamp)."""
    import requests

    values = load_credentials(config)
    invalid: set[str] = set()

    def check(key: str, fn) -> None:
        value = values.get(key)
        if not value:
            return
        try:
            ok = fn(value)
            if ok is False:
                invalid.add(key)
        except Exception:
            # Network trouble is not "invalid"; leave as configured.
            pass

    check(
        "MILLIONVERIFIER_API_KEY",
        lambda v: requests.get(
            "https://api.millionverifier.com/api/v3/credits", params={"api": v}, timeout=15
        ).status_code
        == 200,
    )
    check(
        "EXA_API_KEY",
        lambda v: requests.post(
            "https://api.exa.ai/search",
            json={"query": "ping", "numResults": 1},
            headers={"x-api-key": v},
            timeout=15,
        ).status_code
        != 401,
    )
    check(
        "DEEPSEEK_API_KEY",
        lambda v: requests.get(
            "https://api.deepseek.com/models",
            headers={"authorization": f"Bearer {v}"},
            timeout=15,
        ).status_code
        != 401,
    )
    check(
        "VAYNE_API_KEY",
        lambda v: requests.get(
            "https://www.vayne.io/api/orders",
            headers={"authorization": f"Bearer {v}"},
            timeout=15,
        ).status_code
        not in (401, 403),
    )
    check(
        "INSTANTLY_API_KEY",
        lambda v: requests.get(
            "https://api.instantly.ai/api/v2/campaigns",
            headers={"authorization": f"Bearer {v}"},
            timeout=15,
        ).status_code
        not in (401, 403),
    )

    statuses = detect_statuses(config, invalid)
    return statuses, datetime.now(timezone.utc).isoformat()
