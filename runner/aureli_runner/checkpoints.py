"""Per-run local working directory + atomic checkpoints.

Layout: <config>/runs/<run_id>/
  state.json      — runner-side checkpoint (atomic tmp+rename writes)
  input/          — downloaded source CSV + configuration (originals preserved)
  output/         — stage outputs before upload
  events.jsonl    — full local event log (uploaded as pipeline_log artifact)

Browser closure never touches any of this. After a crash/restart,
`find_incomplete_runs()` detects claimed-but-unfinished jobs and the main loop
resumes them (using each pipeline's native resume where available) without
re-running completed paid stages.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .config import runs_dir


@dataclass
class RunState:
    run_id: str
    stage: str = "stage_one"
    stage_attempt: int = 1
    status: str = "claimed"  # claimed | running | stage_reported | done | cancelled
    completed_stages: list[str] = field(default_factory=list)
    uploaded_artifacts: dict[str, str] = field(default_factory=dict)  # file -> artifact_id
    last_event_seq: int = 0
    mock: bool = False
    instantly_done: bool = False


class RunWorkspace:
    def __init__(self, run_id: str, base: Path | None = None):
        self.root = (base or runs_dir()) / run_id
        self.input_dir = self.root / "input"
        self.output_dir = self.root / "output"
        for path in (self.root, self.input_dir, self.output_dir):
            path.mkdir(parents=True, exist_ok=True)
        self.state_path = self.root / "state.json"

    def load_state(self) -> RunState | None:
        if not self.state_path.is_file():
            return None
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            return RunState(**{k: v for k, v in data.items() if k in RunState.__dataclass_fields__})
        except (OSError, json.JSONDecodeError, TypeError):
            return None

    def save_state(self, state: RunState) -> None:
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(state), indent=2), encoding="utf-8")
        os.replace(tmp, self.state_path)

    def safe_output_path(self, file_name: str) -> Path:
        """Anti-traversal: outputs may only land inside this run's output dir."""
        name = Path(file_name).name
        if not name or name in (".", ".."):
            raise ValueError(f"Unsafe output file name: {file_name!r}")
        candidate = (self.output_dir / name).resolve()
        if not str(candidate).startswith(str(self.output_dir.resolve())):
            raise ValueError(f"Output path escapes the run workspace: {file_name!r}")
        return candidate


def find_incomplete_runs(base: Path | None = None) -> list[str]:
    root = base or runs_dir()
    if not root.is_dir():
        return []
    incomplete = []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        workspace = RunWorkspace(child.name, base=root)
        state = workspace.load_state()
        if state and state.status in ("claimed", "running", "stage_reported"):
            incomplete.append(child.name)
    return incomplete
