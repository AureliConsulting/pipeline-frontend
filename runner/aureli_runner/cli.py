"""aureli_runner CLI.

Commands:
  pair               Exchange a one-time pairing code for a device token.
  run                Foreground daemon: claim & execute jobs (dev/debug too).
  check-credentials  Detect + connection-test local credentials (status only).
  status             Show local configuration and incomplete runs.
  install-startup    Register the runner as a Windows logon task (optional).
  uninstall-startup  Remove the Windows logon task.
  unpair             Delete the local token.
"""
from __future__ import annotations

import argparse
import os
import platform
import subprocess
import sys
from pathlib import Path

from . import __version__
from .checkpoints import find_incomplete_runs
from .client import ApiError, ControlPlaneClient
from .config import RunnerConfig, config_dir, delete_token, load_token, save_token
from .credentials import connection_tests, detect_statuses
from .jobs import RunnerDaemon

STARTUP_TASK_NAME = "AureliRunner"


def _server_url(args, config: RunnerConfig) -> str:
    url = getattr(args, "server", None) or os.environ.get("AURELI_SERVER_URL") or config.server_url
    if not url:
        print("error: no server URL. Pass --server https://your-app.vercel.app (saved for next time).", file=sys.stderr)
        raise SystemExit(2)
    return url.rstrip("/")


def cmd_pair(args) -> int:
    config = RunnerConfig.load()
    server = _server_url(args, config)
    client = ControlPlaneClient(server, token=None)
    name = args.name or f"{platform.node()} ({platform.system()})"
    try:
        result = client.pair(args.code.strip().upper(), name, platform.system().lower())
    except ApiError as exc:
        print(f"Pairing failed: {exc}", file=sys.stderr)
        return 2
    where = save_token(result["token"], use_keychain=args.use_keychain)
    config.server_url = server
    config.runner_id = str(result["runner_id"])
    config.runner_name = str(result["runner_name"])
    config.use_keychain = args.use_keychain and where == "keychain"
    if args.sourcing_dir:
        config.sourcing_pipeline_dir = str(Path(args.sourcing_dir).resolve())
    if args.gtm_dir:
        config.gtm_dir = str(Path(args.gtm_dir).resolve())
    if args.env_file:
        config.env_file = str(Path(args.env_file).resolve())
    config.save()
    print(f"Paired as '{config.runner_name}' (id {config.runner_id}).")
    print(f"Token stored in {where}. Config: {config_dir() / 'config.json'}")
    if not config.sourcing_pipeline_dir or not config.gtm_dir:
        print(
            "NOTE: set pipeline paths before real runs:\n"
            "  python -m aureli_runner pair … --sourcing-dir \"C:\\path\\to\\Lead enrichment\" --gtm-dir \"C:\\path\\to\\GTM Scoring\"\n"
            "  (or edit config.json). Mock runs work without them."
        )
    return 0


def _client_or_die(config: RunnerConfig, args) -> ControlPlaneClient:
    token = load_token()
    if not token:
        print("error: not paired. Run: python -m aureli_runner pair --code <CODE> --server <URL>", file=sys.stderr)
        raise SystemExit(2)
    return ControlPlaneClient(_server_url(args, config), token)


def cmd_run(args) -> int:
    config = RunnerConfig.load()
    client = _client_or_die(config, args)
    daemon = RunnerDaemon(
        config,
        client,
        mock_fast=args.mock_fast or os.environ.get("AURELI_MOCK_FAST") == "1",
        poll_seconds=args.poll,
    )
    try:
        daemon.run_forever(once=args.once)
    except KeyboardInterrupt:
        print("\n[runner] stopped. In-flight checkpoints are preserved; restart to resume.")
    return 0


def cmd_check_credentials(args) -> int:
    config = RunnerConfig.load()
    if args.offline:
        statuses = detect_statuses(config)
        tested_at = None
    else:
        statuses, tested_at = connection_tests(config)
    width = max(len(k) for k in statuses)
    for key, status in statuses.items():
        print(f"{key.ljust(width)}  {status}")
    token = load_token()
    if token and not args.offline:
        try:
            client = ControlPlaneClient(_server_url(args, config), token)
            client.heartbeat(None, statuses, tested_at)
            print("\nReported statuses to the dashboard (values never leave this machine).")
        except ApiError as exc:
            print(f"\nCould not report to dashboard: {exc}")
    return 0


def cmd_status(args) -> int:
    config = RunnerConfig.load()
    print(f"aureli-runner v{__version__}")
    print(f"config dir : {config_dir()}")
    print(f"server     : {config.server_url or '(unset)'}")
    print(f"runner     : {config.runner_name or '(unpaired)'} ({config.runner_id or '-'})")
    print(f"token      : {'present' if load_token() else 'MISSING'}")
    print(f"sourcing   : {config.sourcing_pipeline_dir or '(unset — real stage 1 disabled)'}")
    print(f"gtm dir    : {config.gtm_dir or '(unset — real stage 2 disabled)'}")
    incomplete = find_incomplete_runs()
    print(f"incomplete : {', '.join(incomplete) if incomplete else 'none'}")
    return 0


def cmd_install_startup(args) -> int:
    if platform.system() != "Windows":
        print("install-startup is Windows-only in v1. Use systemd/launchd manually elsewhere.")
        return 2
    python = sys.executable
    command = f'"{python}" -m aureli_runner run'
    # schtasks with an argument LIST (no shell string interpolation of user input).
    result = subprocess.run(  # noqa: S603
        [
            "schtasks", "/Create", "/F",
            "/SC", "ONLOGON",
            "/TN", STARTUP_TASK_NAME,
            "/TR", command,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"Failed to create startup task: {result.stderr.strip()}", file=sys.stderr)
        return result.returncode
    print(f"Startup task '{STARTUP_TASK_NAME}' installed — the runner starts at logon and resumes interrupted jobs.")
    return 0


def cmd_uninstall_startup(args) -> int:
    if platform.system() != "Windows":
        return 2
    result = subprocess.run(  # noqa: S603
        ["schtasks", "/Delete", "/F", "/TN", STARTUP_TASK_NAME], capture_output=True, text=True
    )
    print("Removed." if result.returncode == 0 else result.stderr.strip())
    return result.returncode


def cmd_unpair(args) -> int:
    delete_token()
    print("Local token deleted. Also revoke the device in the dashboard (Settings → Runners).")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m aureli_runner", description="Aureli local pipeline runner")
    parser.add_argument("--server", help="Control-plane URL (e.g. https://your-app.vercel.app)")
    subs = parser.add_subparsers(dest="command", required=True)

    pair = subs.add_parser("pair", help="Pair this machine with your account")
    pair.add_argument("--code", required=True, help="One-time pairing code from the dashboard")
    pair.add_argument("--name", help="Display name for this runner")
    pair.add_argument("--use-keychain", action="store_true", help="Store token in the OS keychain (optional)")
    pair.add_argument("--sourcing-dir", help="Path to the sourcing pipeline project (pipeline.py)")
    pair.add_argument("--gtm-dir", help='Path to the "GTM Scoring" project')
    pair.add_argument("--env-file", help="Explicit .env file for provider credentials")
    pair.set_defaults(func=cmd_pair)

    run = subs.add_parser("run", help="Run the daemon in the foreground")
    run.add_argument("--once", action="store_true", help="Claim/execute at most one job, then exit (dev)")
    run.add_argument("--poll", type=float, default=5.0, help="Claim poll interval seconds")
    run.add_argument("--mock-fast", action="store_true", help="No sleeps in mock mode (tests)")
    run.set_defaults(func=cmd_run)

    check = subs.add_parser("check-credentials", help="Detect and test local credentials")
    check.add_argument("--offline", action="store_true", help="Skip connection tests")
    check.set_defaults(func=cmd_check_credentials)

    subs.add_parser("status", help="Show local runner status").set_defaults(func=cmd_status)
    subs.add_parser("install-startup", help="Start at Windows logon").set_defaults(func=cmd_install_startup)
    subs.add_parser("uninstall-startup", help="Remove the logon task").set_defaults(func=cmd_uninstall_startup)
    subs.add_parser("unpair", help="Delete the local token").set_defaults(func=cmd_unpair)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)
