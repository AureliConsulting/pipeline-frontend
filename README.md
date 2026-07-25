# Aureli Campaign Console

Internal campaign-processing dashboard for Aureli Automations. Two users (Ali
and Julian) run the lead sourcing → verification → GTM scoring →
personalization pipelines from a web dashboard, while all pipeline execution
and all provider API keys stay on their own computers.

```text
┌────────────┐   HTTPS (session)   ┌─────────────────────┐
│  Browser   │ ─────────────────►  │  Next.js on Vercel   │  control plane
│ (Ali/Julian│  ◄── Realtime ────  │  (API routes, RLS-   │  no provider keys
│  dashboard)│                     │   scoped reads)      │
└────────────┘                     └─────────┬───────────┘
                                             │ service role (server only)
                                   ┌─────────▼───────────┐
                                   │      Supabase        │  Postgres + RLS,
                                   │  auth · db · storage │  private buckets,
                                   └─────────▲───────────┘  realtime
                                             │ HTTPS (runner token)
                                   ┌─────────┴───────────┐
                                   │  Local runner (py)   │  execution plane
                                   │  pipelines + .env    │  Vayne/Icypeas/MV/
                                   │  on Ali's/Julian's PC│  Exa/DeepSeek/
                                   └─────────────────────┘  Instantly keys
```

## Repository layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js 15 App Router app (TypeScript strict, Tailwind, deployable to Vercel) |
| `runner` | `aureli_runner` Python package — local execution plane |
| `packages/shared` | Protocol source of truth, zod schemas, state machine, CSV/YAML validation |
| `supabase/migrations` | Database schema, RLS policies, RPCs, storage policies |
| `supabase/tests` | SQL RLS-isolation test |
| `fixtures` | Canonical-schema sample CSV + fixture campaign YAML |
| `docs` | Setup, deployment, runner, security, troubleshooting, assumptions |
| `scripts` | Protocol generator, user provisioning |

## Quick start (local development)

Prereqs: Node 20+, Python 3.11+, [Supabase CLI](https://supabase.com/docs/guides/cli), Docker (only for local Supabase; **not** required for the runner).

```bash
# 1. Install JS deps
npm install

# 2. Start local Supabase and apply migrations
supabase start
supabase db reset          # applies supabase/migrations in order

# 3. Configure the web app
#    copy apps/web/.env.example -> apps/web/.env.local and paste the values
#    printed by `supabase status` (API URL, anon key, service_role key)

# 4. Create the two users
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-users.mjs

# 5. Run the web app
npm run dev                # http://localhost:3000

# 6. Install + pair the local runner (new terminal)
python -m pip install -e ./runner[dev]
#    Dashboard -> Settings -> Runners -> Connect Runner, then:
python -m aureli_runner pair --code <CODE> --server http://localhost:3000
python -m aureli_runner run
```

Create a campaign with the mock toggle enabled and the entire workflow runs
with zero paid API calls (see `docs/runner-setup.md` for mock details, and
`docs/integration-notes.md` for wiring the real pipelines).

## Tests

```bash
npm test                        # shared + web unit tests (vitest)
npm run typecheck               # strict TypeScript
npm run protocol:check          # generated protocol files in sync
python -m pytest runner/tests   # runner unit tests
npm run test:e2e -w apps/web    # Playwright primary flow (needs live stack; see playwright.config.ts)
psql <local-db-url> -f supabase/tests/rls_isolation.sql   # RLS isolation
```

## Documentation

- [docs/setup-supabase.md](docs/setup-supabase.md) — project, migrations, storage, RLS explanation
- [docs/deploy-vercel.md](docs/deploy-vercel.md) — deployment + environment variable matrix
- [docs/runner-setup.md](docs/runner-setup.md) — install, pairing, Windows startup, mock mode
- [docs/integration-notes.md](docs/integration-notes.md) — how the real pipelines are wired, known gaps
- [docs/architecture.md](docs/architecture.md) — components, data flow, state machine (Mermaid)
- [docs/security.md](docs/security.md) — threat model, RLS, tokens, secret handling
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/assumptions.md](docs/assumptions.md) — every judgment call made while building v1
