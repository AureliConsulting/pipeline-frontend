# Assumptions and implementation decisions (v1)

Decisions made where the spec left room, or where the supplied code forced a
choice. Everything here is intentional and test-covered where practical.

1. **Campaign config: YAML surface, JSON substance.** The real pipeline
   consumes strict-Pydantic JSON. Users edit YAML; it is stored verbatim and
   converted losslessly by the runner. Guided (form) edits re-emit YAML with
   all strings double-quoted, which preserves spintax content exactly while
   normalizing only formatting; the raw-YAML path never rewrites anything.
2. **Canonical CSV schema** = the attached enriched export header
   (`AI Heads - 51 to 200 HC - US - Enriched.csv`). Required columns:
   first name, last name, company, corporate website, Email, Status (aliases
   accepted, mirroring the GTM loader). Extra columns are kept; nothing is
   auto-mapped.
3. **CSV campaigns and stage one.** Canonical uploads are already
   discovered + verified, so stage one is a local verification gate (same
   vendor-priority rules as the GTM loader) rather than a re-purchase of
   Icypeas/MillionVerifier calls. Raw Vayne exports do run the real
   `--skip-vayne` pipeline. See `docs/integration-notes.md` §3.
4. **Approval → queued.** After approvals/failure decisions the run returns
   to `queued` with a `next_stage` pointer and (for retries) a `directive`
   ({mode: retry_failed | skip_failed}); the same claim path then drives the
   runner. This keeps the required status enum exactly as specified.
5. **Draft runs.** Uploading a CSV creates the run in `draft` so the file has
   a home before "Start Pipeline"; the wizard's step 4 promotes it.
6. **One active job per runner process.** Multiple runners per user are fully
   supported (and a job claims to exactly one device); a single process
   executes jobs serially — adequate for two users in v1.
7. **Browser is read-only at the database level.** All writes go through API
   routes with the service role after explicit ownership checks. This is the
   strongest practical interpretation of "the browser must not update trusted
   execution fields."
8. **Events retention**: newest 500 per run in Postgres for live display;
   complete JSONL log becomes a private storage artifact. Artifact retention
   is keep-forever in v1 with the deletion hook documented.
9. **Instantly integration is new code** (none existed in the supplied
   projects) and is isolated in one adapter with layered idempotency; mock
   mode never touches it. Endpoint semantics follow Instantly's public v2
   leads API and are the most likely thing to need a tweak on first real use.
10. **No dollar estimates pre-run.** The pipelines don't expose reliable
    pricing ahead of execution; the UI says so and reports actual counts and
    the pipeline's own summary/cost JSON afterwards.
11. **Fonts.** General Sans is referenced with Inter/system fallbacks but not
    bundled (no license file was supplied). Drop the font files into
    `apps/web/src/app` and add `@font-face` rules in `globals.css` to enable.
12. **Users are provisioned by an operator** (script/dashboard); no
    self-signup, no password reset flow in v1 (reset via Supabase dashboard).
13. **Runner token storage** defaults to an owner-protected file;
    OS keychain is optional (`--use-keychain`), per spec.
14. **Two-user scale assumptions**: fixed-window DB rate limiting, ILIKE +
    trigram search, no pagination beyond 100–200 rows anywhere — all
    deliberately simple and adequate for 10k-lead runs and two operators.
15. **DirectSalesNavigatorAdapter** exists and is permanently disabled in v1;
    no LinkedIn cookies anywhere in browser or cloud.
