"""Instantly upload adapter — runs ONLY on the local machine with the locally
stored INSTANTLY_API_KEY, only after explicit final approval in the web app.

Idempotency, in layers:
  1. The server stores exactly one instantly_uploads row per run
     (UNIQUE(run_id)) with a fixed idempotency key.
  2. The runner reports started/completed/failed keyed to that idempotency
     key; a completed upload is never re-run (server returns deduplicated).
  3. Each lead POST carries skip-duplicate flags so an interrupted batch that
     is retried does not create duplicate leads inside Instantly.

NOTE: the supplied pipeline codebases intentionally contain no Instantly
upload implementation. This adapter is therefore a NEW, narrowly scoped
integration against the public Instantly v2 API (POST /api/v2/leads). If your
Instantly workspace uses different semantics, adjust `upload_leads` — the
interface (upload_leads(csv_path, list_id) -> uploaded_count) is the boundary.
"""
from __future__ import annotations

import csv
import time
from pathlib import Path

import requests

from ..redact import redact
from .base import AdapterContext, AdapterError, PermanentAdapterError

INSTANTLY_BASE = "https://api.instantly.ai/api/v2"


class InstantlyUploadAdapter:
    def __init__(self, api_key: str):
        if not api_key:
            raise PermanentAdapterError("INSTANTLY_API_KEY is not configured on this runner")
        self.api_key = api_key

    def upload_leads(self, ctx: AdapterContext, csv_path: Path, list_id: str) -> int:
        with csv_path.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        total = len(rows)
        uploaded = 0
        session = requests.Session()
        headers = {"authorization": f"Bearer {self.api_key}", "content-type": "application/json"}

        for index, row in enumerate(rows, 1):
            if ctx.cancelled():
                raise AdapterError("Upload cancelled")
            email = (row.get("email") or row.get("Email") or "").strip()
            if not email:
                continue
            payload = {
                "campaign": list_id,
                "email": email,
                "first_name": row.get("first_name") or row.get("first name") or "",
                "last_name": row.get("last_name") or row.get("last name") or "",
                "company_name": row.get("company_name") or row.get("company") or "",
                "website": row.get("website") or row.get("corporate website") or "",
                # Everything else rides along as custom variables (spintax-safe:
                # values are passed through exactly as produced by the pipeline).
                "custom_variables": {
                    key: value
                    for key, value in row.items()
                    if key
                    and value
                    and key.lower() not in ("email", "first_name", "first name", "last_name", "last name", "company", "company_name", "website", "corporate website")
                },
                "skip_if_in_campaign": True,
                "skip_if_in_workspace": False,
            }
            for attempt in range(1, 4):
                try:
                    response = session.post(f"{INSTANTLY_BASE}/leads", json=payload, headers=headers, timeout=30)
                except requests.RequestException as exc:
                    if attempt == 3:
                        raise AdapterError(redact(f"Instantly upload network error: {exc}"))
                    time.sleep(2 * attempt)
                    continue
                if response.status_code in (200, 201):
                    uploaded += 1
                    break
                if response.status_code in (401, 403):
                    raise PermanentAdapterError("Instantly API key is invalid or unauthorized")
                if response.status_code == 409:
                    uploaded += 1  # already present — idempotent success
                    break
                if response.status_code in (408, 429) or response.status_code >= 500:
                    if attempt == 3:
                        raise AdapterError(f"Instantly returned {response.status_code} after retries")
                    time.sleep(2 * attempt)
                    continue
                raise AdapterError(f"Instantly rejected lead ({response.status_code}): {response.text[:150]}")
            if index % 10 == 0 or index == total:
                ctx.emit(
                    "stage_progress",
                    f"Instantly upload progress {index}/{total}",
                    current_item=index,
                    total_items=total,
                )
            time.sleep(0.15)  # gentle rate limiting
        return uploaded
