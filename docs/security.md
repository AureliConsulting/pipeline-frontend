# Security model

## Trust boundaries

| Zone | Holds | Trusts |
| --- | --- | --- |
| Browser | session cookie, anon key | nothing else — read-only DB grants |
| Vercel API routes | service-role key (server-only) | session or runner-token identity, verified per request |
| Supabase | data + files | RLS for reads; service role for writes |
| Runner machine | runner token + ALL provider keys | the control plane's signed URLs |

## Controls (spec §14 mapping)

- **Server-side authorization on every protected route** — `requireUser()`
  (session) or `requireRunner()` (Bearer token → SHA-256 lookup, active-only)
  runs before any data access; ownership is re-checked in the query predicates
  (`getOwnedRun`, `requireRunnerRun`). Cross-user lookups return 404, never
  403, so existence is not inferable.
- **RLS** — SELECT-only policies scoped to `auth.uid()` on all 12 tables;
  the browser roles have zero write grants (see `docs/setup-supabase.md`).
  Owner IDs cannot be changed by users: there is no UPDATE grant to abuse.
- **Private storage + signed URLs** — bucket is private; paths are
  server-constructed as `<user>/<run>/<stage>/<safe-name>`; downloads require
  an ownership check and expire in 5 minutes (uploads 10).
- **Runner tokens** — 256-bit random, shown once, stored hashed (SHA-256),
  revocable, scoped to one user; comparisons via constant-time helper.
- **Pairing codes** — 8-char base32, SHA-256-hashed at rest, 10-minute TTL,
  single-use via an atomic `UPDATE … WHERE used_at IS NULL RETURNING`.
- **Rate limiting** — DB-backed fixed windows on pairing (per IP + per user)
  and on runner claim/heartbeat/event endpoints (per device).
- **Input validation** — every route parses with strict zod schemas
  (`.strict()`, discriminated unions); CSV/YAML validated for type, size, row
  count (≤10,000), schema; file names sanitized (`safeFileName`).
- **Secret redaction** — runner redacts before transmit (env-style pairs,
  bearer headers, JWTs, `sk-`/`arn_` tokens, known credential values, signed
  URL query strings); the server redacts again on ingest and in error paths.
  The heartbeat schema only admits status enums, so credential values are
  structurally unable to reach the database.
- **Path traversal** — storage paths built from validated UUIDs + sanitized
  basenames; the runner's `safe_output_path()` confines all pipeline outputs
  to the run workspace; upload-completion verifies the declared path prefix.
- **Command invocation** — the runner always uses argument arrays
  (`subprocess.Popen([...])`); `shell=True` does not appear in the codebase.
- **No secrets in the frontend** — the service-role key lives behind a
  `server-only` import (client bundling = build error); provider keys have no
  representation in web code at all; API errors are redacted and generic.
- **Trusted execution fields** — run status, `claimed_by`, artifact
  verification, and Instantly completion can only change through
  runner-authenticated routes plus the typed state machine with optimistic
  concurrency; the browser cannot write them by construction.

## Non-goals / residual risks (v1, two trusted users)

- The runner trusts the control plane's job payloads (config YAML, CSV). Both
  users are operators of the same company; payloads are still validated and
  size-limited.
- Windows file ACL hardening of `%LOCALAPPDATA%\aureli-runner\token` is left
  to the OS user boundary (documented `icacls` command in troubleshooting);
  keychain storage is available via `--use-keychain`.
- No LinkedIn cookie is stored in the browser or cloud DB. The
  `DirectSalesNavigatorAdapter` stays disabled until a compliant approach
  exists.
