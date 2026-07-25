"""Local runner configuration & token storage.

Config directory:
  Windows: %LOCALAPPDATA%\\aureli-runner
  else:    ~/.aureli-runner

Files:
  config.json  — server URL, runner id/name, pipeline paths (NO secrets)
  token        — the runner device token, protected file. Optionally the OS
                 keychain is used instead (pip install aureli-runner[keychain]);
                 keychain is optional and never required for v1.
  runs/<id>/   — per-run working directories with checkpoints.
"""
from __future__ import annotations

import json
import os
import stat
from dataclasses import dataclass, field
from pathlib import Path

APP_NAME = "aureli-runner"
KEYRING_SERVICE = "aureli-runner"
KEYRING_USER = "runner-token"


def config_dir() -> Path:
    override = os.environ.get("AURELI_RUNNER_HOME")
    if override:
        return Path(override)
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / APP_NAME
    return Path.home() / f".{APP_NAME}"


def runs_dir() -> Path:
    return config_dir() / "runs"


@dataclass
class RunnerConfig:
    server_url: str = ""
    runner_id: str = ""
    runner_name: str = ""
    # Paths to the existing pipeline projects (the runner shells out to them).
    sourcing_pipeline_dir: str = ""  # contains pipeline.py + API_keys.env
    gtm_dir: str = ""  # the "GTM Scoring" project (python -m gtm_research)
    env_file: str = ""  # optional explicit .env path for credentials
    use_keychain: bool = False
    extra: dict = field(default_factory=dict)

    @classmethod
    def load(cls) -> "RunnerConfig":
        path = config_dir() / "config.json"
        if not path.is_file():
            return cls()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return cls()
        known = {f for f in cls.__dataclass_fields__ if f != "extra"}  # type: ignore[attr-defined]
        kwargs = {k: v for k, v in data.items() if k in known}
        extra = {k: v for k, v in data.items() if k not in known}
        return cls(**kwargs, extra=extra)

    def save(self) -> None:
        directory = config_dir()
        directory.mkdir(parents=True, exist_ok=True)
        payload = {
            "server_url": self.server_url,
            "runner_id": self.runner_id,
            "runner_name": self.runner_name,
            "sourcing_pipeline_dir": self.sourcing_pipeline_dir,
            "gtm_dir": self.gtm_dir,
            "env_file": self.env_file,
            "use_keychain": self.use_keychain,
            **self.extra,
        }
        _atomic_write(directory / "config.json", json.dumps(payload, indent=2))


def _atomic_write(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _restrict_permissions(path: Path) -> None:
    """Best-effort: owner-only permissions (POSIX). On Windows the profile
    directory is already per-user; icacls hardening is documented in docs."""
    if os.name != "nt":
        try:
            path.chmod(stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass


def save_token(token: str, use_keychain: bool = False) -> str:
    """Store the runner token. Returns where it was stored ('keychain'|'file')."""
    if use_keychain:
        try:
            import keyring  # type: ignore

            keyring.set_password(KEYRING_SERVICE, KEYRING_USER, token)
            return "keychain"
        except Exception:
            pass  # fall back to file storage
    directory = config_dir()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "token"
    _atomic_write(path, token)
    _restrict_permissions(path)
    return "file"


def load_token() -> str | None:
    config = RunnerConfig.load()
    if config.use_keychain:
        try:
            import keyring  # type: ignore

            token = keyring.get_password(KEYRING_SERVICE, KEYRING_USER)
            if token:
                return token
        except Exception:
            pass
    path = config_dir() / "token"
    if path.is_file():
        token = path.read_text(encoding="utf-8").strip()
        return token or None
    return None


def delete_token() -> None:
    try:
        import keyring  # type: ignore

        keyring.delete_password(KEYRING_SERVICE, KEYRING_USER)
    except Exception:
        pass
    path = config_dir() / "token"
    if path.is_file():
        path.unlink()
