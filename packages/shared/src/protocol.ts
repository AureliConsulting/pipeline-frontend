// GENERATED FILE — do not edit. Source: packages/shared/protocol.json (npm run protocol:generate)
export const PROTOCOL = {
  "$comment": "Single source of truth for the web <-> runner protocol. Edit this file, then run `npm run protocol:generate` to regenerate packages/shared/src/protocol.ts and runner/aureli_runner/protocol.py. CI/tests fail if generated files drift.",
  "protocol_version": "1.0.0",
  "min_compatible_protocol_version": "1.0.0",
  "run_statuses": [
    "draft",
    "awaiting_runner",
    "queued",
    "stage_one_running",
    "stage_one_retrying",
    "stage_one_failed",
    "awaiting_stage_one_approval",
    "stage_two_running",
    "stage_two_retrying",
    "stage_two_failed",
    "fallback_resolver_running",
    "fallback_resolver_retrying",
    "fallback_resolver_failed",
    "awaiting_final_approval",
    "uploading_to_instantly",
    "completed",
    "completed_with_warnings",
    "cancelled"
  ],
  "terminal_statuses": [
    "completed",
    "completed_with_warnings",
    "cancelled"
  ],
  "claimable_statuses": [
    "queued",
    "awaiting_runner"
  ],
  "stages": [
    "stage_one",
    "stage_two",
    "fallback_resolver",
    "instantly_upload"
  ],
  "stage_statuses": [
    "pending",
    "running",
    "retrying",
    "failed",
    "completed",
    "skipped"
  ],
  "event_severities": [
    "debug",
    "info",
    "warn",
    "error"
  ],
  "event_types": [
    "run_claimed",
    "stage_started",
    "stage_progress",
    "stage_retrying",
    "stage_completed",
    "stage_failed",
    "row_failed",
    "artifact_uploaded",
    "approval_requested",
    "approval_decided",
    "instantly_upload_started",
    "instantly_upload_completed",
    "instantly_upload_failed",
    "runner_resumed",
    "log"
  ],
  "artifact_types": [
    "source_csv",
    "vayne_export",
    "email_discovery_output",
    "verification_output",
    "verified_csv",
    "rejected_csv",
    "invalid_email_csv",
    "manual_review_csv",
    "gtm_scored_csv",
    "personalized_csv",
    "instantly_ready_csv",
    "cost_report",
    "evidence_report",
    "pipeline_log",
    "config_snapshot",
    "ready_to_push_csv",
    "blocked_for_review_csv",
    "fallback_audit_csv",
    "run_summary_json"
  ],
  "artifact_stage_map": {
    "source_csv": "stage_one",
    "vayne_export": "stage_one",
    "email_discovery_output": "stage_one",
    "verification_output": "stage_one",
    "verified_csv": "stage_one",
    "invalid_email_csv": "stage_one",
    "rejected_csv": "stage_two",
    "manual_review_csv": "stage_two",
    "gtm_scored_csv": "stage_two",
    "personalized_csv": "stage_two",
    "instantly_ready_csv": "stage_two",
    "cost_report": "stage_two",
    "evidence_report": "stage_two",
    "pipeline_log": "stage_two",
    "config_snapshot": "stage_one",
    "ready_to_push_csv": "fallback_resolver",
    "blocked_for_review_csv": "fallback_resolver",
    "fallback_audit_csv": "fallback_resolver",
    "run_summary_json": "fallback_resolver"
  },
  "approval_kinds": [
    "stage_one",
    "final",
    "failure_decision"
  ],
  "failure_decisions": [
    "retry_failed",
    "skip_failed",
    "cancel"
  ],
  "instantly_upload_statuses": [
    "pending_approval",
    "approved",
    "uploading",
    "completed",
    "failed",
    "cancelled"
  ],
  "run_event_fields": {
    "$comment": "Structured event emitted by the runner. seq is a per-run monotonic integer assigned by the runner; (run_id, seq) is unique server-side which makes batch posts idempotent.",
    "required": [
      "seq",
      "stage",
      "ts",
      "severity",
      "event_type",
      "message"
    ],
    "optional": [
      "current_item",
      "total_items",
      "exa_query_count",
      "retry_count",
      "cost_usd",
      "metadata"
    ]
  },
  "retry_policy": {
    "max_automatic_attempts": 3,
    "base_delay_seconds": 5,
    "max_delay_seconds": 120,
    "jitter_fraction": 0.25
  },
  "limits": {
    "max_leads_per_run": 10000,
    "max_csv_upload_bytes": 52428800,
    "max_yaml_bytes": 262144,
    "pairing_code_ttl_seconds": 600,
    "heartbeat_interval_seconds": 30,
    "runner_offline_after_seconds": 120,
    "event_batch_max": 200,
    "live_events_retained_per_run": 500
  },
  "credential_keys": {
    "$comment": "Credentials the runner detects locally. Only status strings ever leave the machine.",
    "stage_one": [
      "VAYNE_API_KEY",
      "ICYPEAS_API_KEY",
      "ICYPEAS_USER_ID",
      "MILLIONVERIFIER_API_KEY"
    ],
    "stage_two": [
      "EXA_API_KEY",
      "DEEPSEEK_API_KEY"
    ],
    "fallback_resolver": [],
    "instantly_upload": [
      "INSTANTLY_API_KEY"
    ]
  },
  "credential_statuses": [
    "configured",
    "missing",
    "invalid",
    "unchecked"
  ]
} as const;

export type RunStatus = (typeof PROTOCOL.run_statuses)[number];
export type Stage = (typeof PROTOCOL.stages)[number];
export type StageStatus = (typeof PROTOCOL.stage_statuses)[number];
export type EventSeverity = (typeof PROTOCOL.event_severities)[number];
export type EventType = (typeof PROTOCOL.event_types)[number];
export type ArtifactType = (typeof PROTOCOL.artifact_types)[number];
export type ApprovalKind = (typeof PROTOCOL.approval_kinds)[number];
export type FailureDecision = (typeof PROTOCOL.failure_decisions)[number];
export type InstantlyUploadStatus = (typeof PROTOCOL.instantly_upload_statuses)[number];
export type CredentialStatus = (typeof PROTOCOL.credential_statuses)[number];
