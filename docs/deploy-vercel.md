# Vercel deployment

## Steps

1. Push the repository to GitHub.
2. Vercel → New Project → import the repo.
   - Root Directory: `apps/web`
   - Framework preset: Next.js (auto-detected)
   - Install command: `npm install` executed at the repo root (Vercel handles
     workspaces automatically when "Include files outside root" is on, which
     is the default for monorepos).
3. Set the environment variables below.
4. Deploy. Apply migrations to the hosted Supabase project first
   (`supabase db push`).
5. Re-pair runners against the production URL:
   `python -m aureli_runner pair --code <CODE> --server https://your-app.vercel.app`

## Environment variable matrix

| Variable | Vercel | Local web dev (`apps/web/.env.local`) | Local runner |
| --- | :-: | :-: | :-: |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | — |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | — |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ (Sensitive) | ✅ | — |
| `AURELI_SERVER_URL` (optional) | — | — | ✅ |
| `VAYNE_API_KEY` | ❌ never | ❌ never | ✅ (.env) |
| `ICYPEAS_API_KEY` / `ICYPEAS_USER_ID` | ❌ never | ❌ never | ✅ (.env) |
| `MILLIONVERIFIER_API_KEY` | ❌ never | ❌ never | ✅ (.env) |
| `EXA_API_KEY` / `DEEPSEEK_API_KEY` | ❌ never | ❌ never | ✅ (.env) |
| `INSTANTLY_API_KEY` | ❌ never | ❌ never | ✅ (.env) |

Rules:

- Only genuinely public values carry the `NEXT_PUBLIC_` prefix (the anon key
  is public by design — RLS is the boundary).
- `SUPABASE_SERVICE_ROLE_KEY` is imported through a `server-only` module; any
  attempt to pull it into a client bundle fails the build.
- Pipeline-provider credentials are **not in Vercel's variable list at all**,
  by design. The web app has no code path that reads them.

## Operational notes

- API routes are dynamic (no caching); CSV validation happens server-side by
  streaming the uploaded object from Supabase storage, so Vercel's request
  body limit is never in play (browser uploads go directly to storage with a
  signed URL).
- The app works with the browser closed: state lives in Supabase and the
  runner talks to the API directly.
