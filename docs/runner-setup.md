# Local runner — install, pairing, Windows startup, mock mode

The runner is the execution plane. It polls the control plane for jobs
belonging to **your** account, downloads inputs through short-lived signed
URLs, executes the real pipeline scripts with locally stored credentials,
streams structured progress, uploads output artifacts, and resumes
interrupted jobs after crashes or reboots. Docker is **not** required.

## Install

```powershell
# from the repository root (Python 3.11+)
python -m pip install -e ./runner
# with test extras:
python -m pip install -e ./runner[dev]
# optional OS-keychain token storage:
python -m pip install -e ./runner[keychain]
```

## Pair with your account

1. Dashboard → Settings → Runners → **Connect Runner** (generates a one-time
   code valid for 10 minutes).
2. On the runner machine:

```powershell
python -m aureli_runner pair --code ABC123DE --server https://your-app.vercel.app `
  --sourcing-dir "C:\Users\User\Downloads\Lead enrichment" `
  --gtm-dir "C:\Users\User\Downloads\Lead enrichment\GTM Scoring"
```

What happens: the code is exchanged for a long-lived runner token
(`arn_<64 hex>`). The server stores only its SHA-256 hash; the raw token is
written to `%LOCALAPPDATA%\aureli-runner\token` (owner-protected; add
`--use-keychain` to use the OS keychain instead — optional, never required).
Revoke any runner from the dashboard at any time; its token dies immediately.

Runner tokens are scoped to your user. A runner can never see or claim
another user's jobs, and a specific job is atomically claimed by exactly one
device (`FOR UPDATE SKIP LOCKED` + `claimed_by` pinning).

## Credentials

Copy `runner/.env.example` next to your pipelines or point the runner at an
explicit file (`--env-file`). The runner also automatically picks up the
existing `API_keys.env` in the sourcing project and `.env` in the GTM project.

```powershell
python -m aureli_runner check-credentials          # detect + live connection tests
python -m aureli_runner check-credentials --offline  # detection only
```

Only the statuses (configured / missing / invalid / unchecked) are reported
to the dashboard — never values. Connection tests run only when you invoke
this command.

## Run

```powershell
python -m aureli_runner run              # foreground daemon (dev + prod)
python -m aureli_runner run --once       # claim at most one job, then exit
python -m aureli_runner run --mock-fast  # skip simulated delays in mock runs
python -m aureli_runner status           # config + incomplete runs
```

## Windows startup (optional)

```powershell
python -m aureli_runner install-startup    # schtasks ONLOGON task "AureliRunner"
python -m aureli_runner uninstall-startup
```

On logon the runner scans `%LOCALAPPDATA%\aureli-runner\runs\` for
claimed-but-unfinished jobs and resumes them:

- stage checkpoints are written atomically (`state.json` tmp+rename);
- original inputs and generated outputs are preserved per run;
- the last acknowledged event `seq` is recorded, and events are idempotent
  server-side, so nothing is duplicated after a crash;
- pipeline-native resume is used wherever it exists — the sourcing pipeline
  resumes from `<name>_mv_progress.csv` / existing Vayne orders / existing
  Icypeas batches, and the GTM pipeline resumes from its per-company
  checkpoints and evidence cache. A paid stage is never re-run because the
  browser closed or the machine restarted.

## Mock mode

Toggle **Mock run** in the campaign wizard's confirm step. Mock runs:

- process the uploaded CSV (or a bundled fixture) with zero paid API calls
  (a pytest asserts the mock adapter cannot open sockets);
- simulate realistic progress, one transient retry per stage, and a partial
  row failure;
- produce real, downloadable fixture artifacts for every output type;
- pause at both approval checkpoints exactly like real runs;
- finish with a fake Instantly upload if you approve one;
- are labeled MOCK everywhere in the UI.

Use `fixtures/sample_leads.csv` as the upload; it matches the canonical v1
schema and includes a duplicate row and an unverified row on purpose.
