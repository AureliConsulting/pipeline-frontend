# Real-pipeline integration notes

The adapters wrap the two existing projects **as-is** — no pipeline logic was
rewritten. This file records exactly how, plus every incompatibility found
during inspection and how v1 handles it.

## Inspected sources of truth

| Pipeline | Location (on Ali's machine) | Entry point |
| --- | --- | --- |
| Sourcing & verification | `C:\Users\User\Downloads\Lead enrichment` | `python pipeline.py --url … --name … [--limit N] [--out DIR] [--skip-vayne] [--skip-icypeas]` |
| GTM scoring & personalization | `C:\Users\User\Downloads\Lead enrichment\GTM Scoring` | `python -m gtm_research run …` / `python -m gtm_research personalize …` |

### Pipeline 1 facts (from `pipeline.py`)

- Env (loaded from `API_keys.env` beside the script): `VAYNE_API_KEY`,
  `ICYPEAS_API_KEY`, `ICYPEAS_USER_ID`, `MILLIONVERIFIER_API_KEY`.
- Outputs in `--out`: `<name>_vayne_raw.csv`, `<name>_icypeas_results.csv`,
  `<name>_combined.csv`, `<name>_mv_progress.csv` (resume checkpoint),
  `<name>_final.csv` (MillionVerifier quality == "good" only).
- Native resume: MV resumes from the progress CSV; a 409 from Vayne reuses
  the existing order; Icypeas batches are deduplicated client-side by name.
- The adapter (`runner/aureli_runner/adapters/sourcing_adapter.py`) maps these
  files to artifact types and parses `[i/N]` stdout lines into progress
  events.

### Pipeline 2 facts (from `gtm_research`)

- Env (`.env` found upward from CWD): `EXA_API_KEY`, `DEEPSEEK_API_KEY`,
  optional `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `MAX_CONCURRENCY`,
  `MAX_EXA_REQUESTS_PER_COMPANY`, `MAX_EXA_RESULTS_PER_QUERY`,
  `REQUEST_TIMEOUT_SECONDS`, `MAX_RETRIES`.
- `run` writes `<stem>_scored_deepseek.csv`, `<stem>_scored_final.csv`,
  `<stem>_failures.csv`, `<stem>_reconciliation.csv`, `<stem>_summary.json`
  (used as the cost report) and keeps per-company checkpoints + evidence
  cache under `data/runs/<stem>-<hash>/` — that is its native resume, driven
  by `--resume` / `--only-failed`.
- `personalize` consumes the scored final CSV plus a **JSON** campaign config
  and writes the personalized, send-ready, and manual-review CSVs, with
  `--resume` caching.
- Eligibility gate: rows need a company plus a verified email
  (MillionVerifier `mv_result/mv_quality`, Icypeas status, or legacy
  `Status` ∈ {95%, 99%}). The adapter surfaces the pipeline's own
  zero-eligible diagnostics as a permanent (non-retried) failure.

## Deliberate incompatibility handling

1. **The spec says YAML; the pipeline consumes JSON.**
   `gtm_research` deliberately uses JSON campaign configs (strict Pydantic,
   `extra="forbid"`). Resolution: users author YAML (readable, spintax
   quoted); the web app validates against a zod mirror of the Pydantic model;
   the stored YAML is kept verbatim and the runner converts it 1:1 to JSON
   (`yaml.safe_load` → `json.dump`, values untouched) before invoking
   `personalize`. The YAML schema was NOT silently altered — it is exactly the
   JSON schema, expressed in YAML.
2. **Follow-up copy is not in the config.** Emails 1–3 are fixed template
   files (`templates/aureli_*_v*.txt`) rendered by the pipeline; the config
   carries proof/offers/bridges/style constraints. Per spec ("when represented
   by the YAML"), the UI edits what the config actually represents and does
   not fabricate a follow-up editor.
3. **`pipeline.py` cannot ingest arbitrary CSVs.** Its `--skip-vayne` path
   assumes the Vayne "simple" column order. Resolution in the CSV campaign
   path: (a) raw Vayne exports (no verification columns) are staged as
   `<name>_vayne_raw.csv` and run through the real `--skip-vayne` path so
   Icypeas + MillionVerifier execute; (b) the canonical v1 upload (the
   attached enriched export) is already discovered + verified, so stage one
   gates it locally with the same vendor-priority rules as the GTM loader —
   zero paid calls, no fabricated re-verification. This local gate is the one
   piece of new stage-one logic, and it is a filter, not an enrichment.
4. **No Instantly upload exists in the supplied code** (the hermes CLI keeps
   it deliberately disabled). Rather than invent hidden behavior inside a
   pipeline, the runner has a separate, narrowly scoped
   `InstantlyUploadAdapter` (Instantly v2 `POST /api/v2/leads`, per-lead
   skip-duplicate flags, bounded retries). It runs only after the typed
   double-confirmation and only on the local machine. Mock mode fakes it.
5. **Evidence reports** are a directory of per-company JSON files
   (`evidence_cache/`), not a single artifact. v1 ships the reconciliation
   CSV + summary JSON + full event log as the review artifacts and leaves the
   cache on the runner disk (documented, preserved for the pipeline's own
   resume).
6. **Cost estimates before a run** are not computable from the supplied code
   (Exa/DeepSeek spend depends on per-company query plans). The UI says so
   instead of pretending; actual cost data from `_summary.json` is surfaced
   after stage two.

## Switching to real runs

1. Pair the runner with `--sourcing-dir` and `--gtm-dir` pointing at the two
   projects (see `docs/runner-setup.md`).
2. Fill the provider keys in a local `.env` / the projects' existing env
   files; run `python -m aureli_runner check-credentials`.
3. Create a campaign with the mock toggle OFF. Everything else — approvals,
   retries, resume, artifacts, Instantly — behaves exactly like mock runs.
