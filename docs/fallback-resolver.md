# Manual review fallback resolver (stage 3)

A mandatory third pipeline stage that runs automatically after stage 2
(GTM scoring & personalization), before the final/Instantly checkpoint.
It deterministically fills in safe fallback values for leads that were
flagged for manual review, validates every row, and quarantines anything it
can't safely deliver. No model, no network calls — see
`gtm_research/personalization/fallback_resolver.py` in the GTM Scoring
project (invoked only via `python -m gtm_research resolve-manual-review`,
never reimplemented here).

## Flow

```
stage_one → stage_two → fallback_resolver → awaiting_final_approval → (optional) Instantly upload
```

stage_two's completion never pauses for approval — it auto-advances
(`next_stage = fallback_resolver`, status `queued`) straight into the
resolver. The resolver's own completion is what reaches
`awaiting_final_approval`, whether or not it quarantined rows: exit code 2
(blocked rows present, `--allow-partial` not set) is treated as a completed
stage with warnings, not a failure. Only a genuine config/input error (exit 1,
or the external project missing) fails the stage and raises a
`failure_decision` approval (retry / skip / cancel), same as stage 1 and 2.

## Artifacts

Written to the run's output directory, registered under artifact types
`ready_to_push_csv`, `blocked_for_review_csv`, `fallback_audit_csv`,
`run_summary_json`:

| Artifact | Schema |
|---|---|
| `ready_to_push.csv` | `email`, each campaign variable's mapped Instantly output column, `automation_status`, `fallback_applied`, `fallback_fields`, `validation_errors` |
| `blocked_for_review.csv` | all original input CSV headers (preserved order), then internal resolver variable names not already present, then `automation_status`, `fallback_applied`, `fallback_fields`, `validation_errors` |
| `fallback_audit.csv` | `campaign_key`, `campaign_config_hash`, `row_number`, `email`, `field`, `internal_field`, `output_field`, `old_value`, `new_value`, `rule_type`, `rule_index` |
| `run_summary.json` | `input_rows`, `targeted_rows`, `remediated_rows`, `ready_rows`, `blocked_rows`, `fallback_changes`, `blocked_reason_counts`, `campaign_key`, `campaign_name`, `campaign_config_hash`, `partial_mode`, `outputs` (paths) |

`automation_status` is one of `READY` / `READY_FALLBACK` / `BLOCKED`.
`validation_errors` is semicolon-separated error codes, blank for ready rows.

## Fallback rules JSON

Optional, shared (non-campaign-specific) JSON handed to the resolver's
`--config` flag, stored in `public.fallback_rule_sets` and managed at
**Settings → Fallback Rules**, or picked per-run in the campaign launch
wizard (`campaigns.fallback_rule_set_id` is the campaign's default;
`pipeline_runs.fallback_rule_set_id` snapshots the choice made at launch so
editing the shared rule set later never changes an already-launched run).
Leaving it unset uses the resolver's own built-in defaults
(`config/fallback_rules.json` in the GTM Scoring project).

## Allow partial

`pipeline_runs.allow_partial`, set once at run creation, passed to the
resolver as `--allow-partial`. It does **not** change what
`ready_to_push.csv` contains — blocked leads are always excluded from it
either way. It only changes whether leftover blocked rows are reported as
`partial_mode: true` (informational) in `run_summary.json`, and is separate
from the Instantly export's own gate (below).

## Export gate (fail-closed)

The Instantly upload dialog (`FinalActions.tsx`) always uploads
`ready_to_push.csv` — never `blocked_for_review.csv`, and the Lead Review
page's blocked tab has no select/export affordance at all, so blocked leads
can never enter an upload by construction. When `blocked_rows > 0`, the
dialog additionally requires an explicit "I understand N blocked lead(s)
will be excluded" checkbox before the confirm button enables
(`canConfirmInstantlyUpload` in `apps/web/src/lib/exportGate.ts`) —
independent of whatever `allow_partial` was set to at run creation.

## UI

- **Run Summary** (`/runs/[id]/results`) — counts, blocked-reason table, a
  fail-closed banner when blocked rows exist and partial mode was off, and
  download links for all four artifacts.
- **Lead Review** (`/runs/[id]/leads`) — tabs for ready/blocked, search,
  sortable columns, pagination, validation-error badges.
- **Audit** (`/runs/[id]/audit`) — `fallback_audit.csv` rendered 1:1 with
  filters by email, field, and rule type.
- **Settings → Fallback Rules** (`/settings/fallback-rules`) — library of
  saved rule sets.

## Testing locally

Mock runs exercise the whole stage without the external GTM Scoring
project: `MockPipelineAdapter._fallback_resolver` (in
`runner/aureli_runner/adapters/mock_adapter.py`) fabricates all four
artifacts and deterministically blocks the last fixture row (no email), so
a mock run always has something to review in the blocked tab and the
partial-mode banner. Toggle "Mock run" in the campaign wizard's confirm
step to use it.

Runner-side unit tests: `runner/tests/test_fallback_resolver_adapter.py`.
Frontend unit tests: `apps/web/test/fallbackResolverStage.test.ts` (stage
dispatch), `apps/web/test/exportGate.test.ts` (blocked-rows checkbox gate).
