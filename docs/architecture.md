# Architecture

## Components

```mermaid
flowchart LR
  subgraph Browser["Browser (Ali / Julian)"]
    UI[Next.js UI\nDashboard · Wizard · Progress · Review · Results · Settings]
  end

  subgraph Vercel["Vercel — control plane"]
    API[API routes\nzod-validated, session/runner auth]
    MW[Middleware\nsession refresh + gate]
  end

  subgraph Supabase
    AUTH[Auth\nemail+password, no signup]
    DB[(Postgres\nRLS, typed enums, RPCs)]
    ST[(Private storage\nartifacts/&lt;user&gt;/&lt;run&gt;/&lt;stage&gt;/)]
    RT[Realtime\nRLS-scoped changes]
  end

  subgraph Local["Ali's / Julian's PC — execution plane"]
    RUN[aureli_runner daemon]
    P1[pipeline.py\nVayne → Icypeas → MillionVerifier]
    P2[gtm_research\nExa → DeepSeek → scoring → personalize]
    ENV[.env — provider keys\nNEVER leave this machine]
    INST[Instantly upload adapter]
  end

  UI -->|HTTPS session| API
  UI <-->|subscribe| RT
  MW --> AUTH
  API -->|service role, ownership-checked| DB
  API -->|signed URLs| ST
  RUN -->|Bearer runner token| API
  RUN --> P1 & P2 & INST
  P1 & P2 --> ENV
  RUN -->|upload/download via signed URLs| ST
```

## Run state machine

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> queued: start (runner online)
  draft --> awaiting_runner: start (no runner)
  awaiting_runner --> stage_one_running: claim
  queued --> stage_one_running: claim (next_stage=1)
  queued --> stage_two_running: claim (next_stage=2)
  stage_one_running --> stage_one_retrying: transient error
  stage_one_retrying --> stage_one_running: retry
  stage_one_running --> stage_one_failed: retries exhausted / permanent
  stage_one_retrying --> stage_one_failed
  stage_one_running --> awaiting_stage_one_approval: pipeline 1 done
  stage_one_retrying --> awaiting_stage_one_approval
  awaiting_stage_one_approval --> queued: approve → stage 2 / retry failed → stage 1
  stage_one_failed --> queued: retry / skip failed rows
  stage_two_running --> stage_two_retrying
  stage_two_retrying --> stage_two_running
  stage_two_running --> stage_two_failed
  stage_two_retrying --> stage_two_failed
  stage_two_running --> awaiting_final_approval: pipeline 2 done
  stage_two_retrying --> awaiting_final_approval
  stage_two_failed --> queued
  awaiting_final_approval --> completed: complete (no upload)
  awaiting_final_approval --> completed_with_warnings
  awaiting_final_approval --> uploading_to_instantly: typed confirmation
  uploading_to_instantly --> completed: upload ok
  uploading_to_instantly --> awaiting_final_approval: upload failed (retryable)
  draft --> cancelled
  awaiting_runner --> cancelled
  queued --> cancelled
  stage_one_running --> cancelled
  awaiting_stage_one_approval --> cancelled
  stage_two_running --> cancelled
  stage_one_failed --> cancelled
  stage_two_failed --> cancelled
  awaiting_final_approval --> cancelled
  completed --> [*]
  completed_with_warnings --> [*]
  cancelled --> [*]
```

Enforced in three places that must agree (tests pin all three): the
`run_status` Postgres enum, `packages/shared/src/stateMachine.ts` (every
server-side transition), and `runner/aureli_runner/protocol.py` (generated).

## Key flows

**Job claim** — `claim_next_job` RPC: looks up the runner by token hash,
selects the oldest claimable run **of that runner's user** with
`FOR UPDATE SKIP LOCKED`, pins `claimed_by`, flips status, and upserts the
stage row — one atomic transaction, so two runners can never double-claim.

**Events** — the runner assigns a monotonic `seq` per run and batches events;
`append_run_events` inserts with `ON CONFLICT (run_id, seq) DO NOTHING`,
updates the denormalized progress blob, and trims Postgres to the newest 500
events (the full log ships as a storage artifact). Browser gets Supabase
Realtime with a 5s polling fallback.

**Approvals** — stage completion never advances past a checkpoint: the server
sets `awaiting_stage_one_approval` / `awaiting_final_approval` and creates an
`approval_requests` row. Only an authenticated owner decision moves the run
on. Instantly uploads additionally require re-typing the campaign title and
lead count and are idempotent end-to-end (UNIQUE(run_id) + idempotency key +
per-lead skip-duplicate flags).

**Recovery** — browser closure is irrelevant (state lives server-side).
Runner/PC restarts: local `state.json` checkpoints + `find_incomplete_runs()`
+ claim-with-`resume_run_id` re-attach the device to its in-flight run, and
pipeline-native resume (MV progress CSV, Vayne order reuse, Icypeas batch
dedup, GTM per-company checkpoints) guarantees paid work is never repeated.

## Protocol versioning

`packages/shared/protocol.json` is the single source of truth
(`protocol_version` 1.0.0). `npm run protocol:generate` emits the TS and
Python modules; `npm run protocol:check` + tests in both languages fail on
drift. Every runner request carries its protocol version; pairing and claim
reject incompatible versions, and heartbeats surface a warning banner on the
Runners page.
