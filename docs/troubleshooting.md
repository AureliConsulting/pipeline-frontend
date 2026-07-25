# Troubleshooting

## Web app

| Symptom | Cause / fix |
| --- | --- |
| Login page says "application is not configured" | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing. Copy `apps/web/.env.example` → `.env.local`. |
| Sign-in fails for a known user | User not created or password wrong — re-run `scripts/create-users.mjs`; check Supabase Auth → Users. Signup is disabled by design. |
| 500s mentioning service role | `SUPABASE_SERVICE_ROLE_KEY` missing on the server (Vercel env / `.env.local`). |
| Uploads fail immediately | Storage migration not applied (`0005_storage.sql`) or file >50 MB / not `.csv`. |
| "Validation failed — fix the file" | Missing canonical columns. The app never auto-maps columns; align the header with `fixtures/sample_leads.csv`. |
| Progress page never updates | Realtime not enabled for the tables (re-run `0003_rls.sql`) — the page still works via 5s polling; check the Realtime/Polling badge. |
| Run stuck in `awaiting_runner` | No online runner. Start `python -m aureli_runner run`; check Settings → Runners for last heartbeat. |

## Runner

| Symptom | Cause / fix |
| --- | --- |
| `Pairing failed: 401` | Code expired (10 min), already used, or typo. Generate a new one. |
| `Pairing failed: 429` | Rate limit — wait 5 minutes. |
| `token rejected — was this runner revoked?` | Device revoked in dashboard. `python -m aureli_runner unpair` then pair again. |
| `protocol_mismatch` | Runner and web app were updated out of step. `git pull` + `pip install -e ./runner`, or redeploy the web app. |
| Credentials show "missing" | The `.env` isn't where the runner looks. Pass `--env-file` at pair time or set `env_file` in `%LOCALAPPDATA%\aureli-runner\config.json`. |
| Credentials show "invalid" | The provider rejected the key during `check-credentials`. Rotate the key locally; nothing needs to change server-side. |
| Real stage fails instantly with "not found at …" | `sourcing_pipeline_dir` / `gtm_dir` unset or wrong in config.json. |
| GTM stage fails with `zero_eligible_rows` | The verified CSV has no rows passing the GTM email gate — this is the pipeline's own guard, surfaced verbatim. Inspect the stage-one verified CSV. |
| Windows: startup task didn't appear | Run the shell as the same user; check `schtasks /Query /TN AureliRunner`. |
| Machine crashed mid-run | Just restart the runner (or reboot — with the startup task installed it resumes alone). Local checkpoints + native pipeline resume prevent re-paying for finished work. |
| `pytest` errors with `PermissionError: … Temp\pytest-of-User` | A stale system temp dir owned by another account. Run `python -m pytest tests -q --basetemp=.pytest_tmp` (any writable dir works). |

Harden the token file (optional):

```powershell
icacls "$env:LOCALAPPDATA\aureli-runner\token" /inheritance:r /grant:r "$env:USERNAME:(R,W)"
```

## Database

- Reset local dev completely: `supabase db reset` (reapplies all migrations).
- Verify isolation: `psql <db-url> -f supabase/tests/rls_isolation.sql` — the
  script raises on any breach and prints `RLS isolation checks passed`.
- `run_events` only ever holds the newest ~500 rows per run; the full log is
  the `pipeline_log` artifact on the run's Results page.
