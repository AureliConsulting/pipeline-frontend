"""HTTP client for the control-plane API. Bearer runner-token auth, transient
retries with backoff, and secret redaction on every error path."""
from __future__ import annotations

import time
from typing import Any

import requests

from . import __version__
from .protocol import PROTOCOL_VERSION
from .redact import redact, redact_url
from .retry import classify_error, next_retry


class ApiError(RuntimeError):
    def __init__(self, status: int, message: str, code: str | None = None):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.code = code


class ControlPlaneClient:
    def __init__(self, server_url: str, token: str | None, timeout: int = 60):
        self.base = server_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.session = requests.Session()

    # ------------------------------------------------------------------ core
    def _headers(self) -> dict[str, str]:
        headers = {"user-agent": f"aureli-runner/{__version__}"}
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"
        return headers

    def request(
        self,
        method: str,
        path: str,
        json_body: dict | None = None,
        max_attempts: int = 4,
    ) -> dict[str, Any]:
        url = f"{self.base}{path}"
        attempt = 1
        while True:
            try:
                response = self.session.request(
                    method, url, json=json_body, headers=self._headers(), timeout=self.timeout
                )
            except requests.RequestException as exc:
                decision = next_retry(attempt, "transient")
                if attempt < max_attempts and decision.retry:
                    time.sleep(decision.delay_seconds)
                    attempt += 1
                    continue
                raise ApiError(0, redact(f"network error calling {redact_url(url)}: {exc}"))
            if response.status_code < 400:
                try:
                    return response.json()
                except ValueError:
                    return {}
            # Error handling
            try:
                body = response.json()
                message = str(body.get("error", response.text[:200]))
                code = body.get("code")
            except ValueError:
                message, code = response.text[:200], None
            error_class = classify_error(message, response.status_code)
            if error_class == "transient" and attempt < max_attempts:
                decision = next_retry(attempt, "transient")
                time.sleep(decision.delay_seconds)
                attempt += 1
                continue
            raise ApiError(response.status_code, redact(message), code)

    # ------------------------------------------------------------- endpoints
    def pair(self, code: str, runner_name: str, platform: str) -> dict[str, Any]:
        return self.request(
            "POST",
            "/api/runner/pair",
            {
                "code": code,
                "runner_name": runner_name,
                "platform": platform,
                "runner_version": __version__,
                "protocol_version": PROTOCOL_VERSION,
            },
        )

    def heartbeat(
        self,
        active_run_id: str | None,
        credentials: dict[str, str],
        last_connection_test_at: str | None,
    ) -> dict[str, Any]:
        return self.request(
            "POST",
            "/api/runner/heartbeat",
            {
                "active_run_id": active_run_id,
                "runner_version": __version__,
                "protocol_version": PROTOCOL_VERSION,
                "credentials": credentials,
                "last_connection_test_at": last_connection_test_at,
            },
        )

    def claim(self, resume_run_id: str | None = None) -> dict[str, Any] | None:
        body = self.request(
            "POST",
            "/api/runner/claim",
            {"protocol_version": PROTOCOL_VERSION, "resume_run_id": resume_run_id},
        )
        return body.get("job")

    def run_status(self, run_id: str) -> dict[str, Any]:
        return self.request("GET", f"/api/runner/runs/{run_id}")

    def run_input(self, run_id: str) -> dict[str, Any]:
        return self.request("GET", f"/api/runner/runs/{run_id}/input")

    def post_events(self, run_id: str, events: list[dict[str, Any]]) -> None:
        self.request("POST", f"/api/runner/runs/{run_id}/events", {"events": events})

    def stage_complete(self, run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", f"/api/runner/runs/{run_id}/stage-complete", payload)

    def register_artifact(self, run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", f"/api/runner/runs/{run_id}/artifacts", payload)

    def confirm_artifact(self, run_id: str, artifact_id: str, size_bytes: int, content_hash: str | None) -> None:
        self.request(
            "PATCH",
            f"/api/runner/runs/{run_id}/artifacts",
            {"artifact_id": artifact_id, "size_bytes": size_bytes, "content_hash": content_hash},
        )

    def instantly_progress(self, run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", f"/api/runner/runs/{run_id}/instantly", payload)

    # -------------------------------------------------------------- storage
    def upload_signed(self, signed_url: str, file_path) -> None:
        """PUT file bytes to a Supabase signed upload URL."""
        with open(file_path, "rb") as handle:
            response = self.session.put(
                signed_url,
                data=handle,
                headers={"content-type": "application/octet-stream", "x-upsert": "true"},
                timeout=300,
            )
        if response.status_code >= 400:
            raise ApiError(response.status_code, f"artifact upload failed: {response.text[:200]}")

    def download_signed(self, signed_url: str, dest_path) -> None:
        with self.session.get(signed_url, stream=True, timeout=300) as response:
            response.raise_for_status()
            with open(dest_path, "wb") as out:
                for chunk in response.iter_content(65536):
                    out.write(chunk)
