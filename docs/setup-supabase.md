# Supabase setup

## 1. Create the project

Hosted: create a project at supabase.com (region close to you; the free tier
works for v1). Local: `supabase start` (requires Docker; the CLI prints the
API URL, anon key, service_role key, and DB URL).

## 2. Apply migrations

```bash
# local
supabase db reset

# hosted
supabase link --project-ref <your-project-ref>
supabase db push
```

Migrations run in order:

| File | Contents |
| --- | --- |
| `0001_types.sql` | Typed enums — `run_status` mirrors `packages/shared/protocol.json` (a test asserts parity) |
| `0002_tables.sql` | `profiles`, `campaigns`, `campaign_configs`, `pipeline_runs`, `run_stages`, `run_events`, `artifacts`, `runner_devices`, `runner_pairing_codes`, `runner_heartbeats`, `approval_requests`, `instantly_uploads`, `api_rate_limits` |
| `0003_rls.sql` | RLS + grants (see below) + realtime publication |
| `0004_functions.sql` | `consume_pairing_code`, `check_rate_limit`, `claim_next_job`, `append_run_events` |
| `0005_storage.sql` | Private `artifacts` bucket + owner-folder read policy |

## 3. Auth configuration

Signup is **disabled** (internal tool). In the dashboard: Authentication →
Providers → Email → disable signups; confirmations off (or keep on and confirm
manually). Create the two users:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-users.mjs
```

(Passwords are prompted or read from `ALI_PASSWORD` / `JULIAN_PASSWORD`.)

## 4. Storage

`0005_storage.sql` creates the private `artifacts` bucket (50 MB per-file cap,
CSV/JSON/YAML/text MIME types). Object paths are always
`<user_id>/<run_id>/<stage>/<file>`; the only storage policy grants
authenticated users **read** on their own top-level folder. All writes happen
through server routes via short-lived signed upload URLs.

## 5. How RLS works here (and why browser writes are impossible)

- Every user-owned table carries `user_id` and has
  `USING (user_id = auth.uid())` SELECT policies — users can only ever read
  their own rows, including through Supabase Realtime.
- The browser roles (`anon`, `authenticated`) have **SELECT-only grants**.
  There are no INSERT/UPDATE/DELETE policies or grants at all, so a browser
  client cannot update trusted execution fields (run status, `claimed_by`,
  artifact verification, Instantly completion) or reassign `user_id` to steal
  a record — the write path simply does not exist for those roles.
- All writes go through Next.js API routes using the **service-role key**
  (server-only). Each route independently verifies session ownership (or
  runner-token identity) before touching a row, and status changes must pass
  the typed state machine (`packages/shared/src/stateMachine.ts`).
- `anon` has no grants: unauthenticated users see nothing.

Verify isolation locally:

```bash
psql "$(supabase status -o json | jq -r .DB_URL)" -f supabase/tests/rls_isolation.sql
```

## 6. Retention

Version one keeps all artifacts. `run_events` is the only auto-trimmed data:
`append_run_events` keeps the newest 500 rows per run (the complete log is a
private storage artifact). Artifact retention is a policy hook: add a
scheduled job that deletes storage objects + `artifacts` rows older than your
chosen window when you need it.
