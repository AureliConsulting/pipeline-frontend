-- Core tables. Every user-owned record carries owner_id (named user_id) and is
-- covered by RLS in 0003_rls.sql. All browser access is read-only; writes go
-- through server routes (service role) which validate ownership + transitions.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- Keep profiles in sync with auth.users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  input_type public.input_type not null,
  max_leads integer not null check (max_leads between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_user_idx on public.campaigns (user_id, created_at desc);
create index campaigns_title_trgm_idx on public.campaigns using gin (title gin_trgm_ops);

create table public.campaign_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  -- Raw YAML exactly as entered; spintax and copy strings are never rewritten.
  yaml_text text not null,
  -- Parsed + schema-validated form used for preview and passed to the pipeline.
  normalized_json jsonb not null,
  schema_source text not null default 'gtm_research.CampaignConfig',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaign_configs_user_idx on public.campaign_configs (user_id, updated_at desc);

create table public.runner_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  -- SHA-256 hex of the runner token. The raw token is returned exactly once
  -- at pairing time and never stored server-side.
  token_hash text not null unique,
  status public.runner_status not null default 'active',
  platform text not null default '',
  runner_version text not null default '',
  protocol_version text not null default '',
  -- Status-only credential report (configured/missing/invalid/unchecked).
  credential_report jsonb not null default '{}'::jsonb,
  last_connection_test_at timestamptz,
  last_seen_at timestamptz,
  paired_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index runner_devices_user_idx on public.runner_devices (user_id);

create table public.runner_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index runner_pairing_codes_user_idx on public.runner_pairing_codes (user_id, created_at desc);

create table public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  -- Chosen in wizard step 3; must be set before the run can be queued.
  config_id uuid references public.campaign_configs (id),
  status public.run_status not null default 'draft',
  -- The stage a claiming runner should execute next (set on queue/approval).
  next_stage public.stage_key not null default 'stage_one',
  current_stage public.stage_key,
  mock boolean not null default false,
  -- {type:'csv', artifact_id, validation} | {type:'sales_navigator', url, requested_limit}
  source jsonb not null default '{}'::jsonb,
  claimed_by uuid references public.runner_devices (id) on delete set null,
  -- Instruction for the next stage execution, set by approval/failure
  -- decisions: {mode:'retry_failed'|'skip_failed'} etc. Cleared on claim.
  directive jsonb not null default '{}'::jsonb,
  -- Denormalized live progress for cheap dashboards; authoritative data lives
  -- in run_stages/run_events. Updated only by append_run_events()/server.
  progress jsonb not null default '{}'::jsonb,
  lead_count integer,
  warnings text[] not null default '{}',
  error text,
  last_event_seq bigint not null default -1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index pipeline_runs_user_idx on public.pipeline_runs (user_id, created_at desc);
create index pipeline_runs_claim_idx on public.pipeline_runs (user_id, status, created_at)
  where status in ('queued', 'awaiting_runner');

create table public.run_stages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pipeline_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  stage public.stage_key not null,
  status public.stage_status not null default 'pending',
  attempt integer not null default 0,
  counts jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz,
  ended_at timestamptz,
  unique (run_id, stage)
);
create index run_stages_run_idx on public.run_stages (run_id);

create table public.run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.pipeline_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seq bigint not null,
  stage public.stage_key not null,
  ts timestamptz not null,
  severity public.event_severity not null,
  event_type text not null,
  message text not null,
  current_item integer,
  total_items integer,
  exa_query_count integer,
  retry_count integer,
  cost_usd numeric(12, 4),
  metadata jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);
create index run_events_run_idx on public.run_events (run_id, seq desc);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pipeline_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  stage public.stage_key not null,
  artifact_type text not null,
  file_name text not null,
  -- Path inside the private 'artifacts' bucket: <user_id>/<run_id>/<stage>/<file>
  storage_path text not null unique,
  size_bytes bigint not null default 0,
  row_count integer,
  content_hash text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  -- Scoped per stage: the runner can register a same-named file (e.g. its
  -- own events.jsonl pipeline_log) once per stage without colliding.
  unique (run_id, stage, artifact_type, file_name)
);
create index artifacts_run_idx on public.artifacts (run_id);

create table public.runner_heartbeats (
  id bigint generated always as identity primary key,
  runner_device_id uuid not null references public.runner_devices (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  active_run_id uuid references public.pipeline_runs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index runner_heartbeats_device_idx on public.runner_heartbeats (runner_device_id, created_at desc);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pipeline_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.approval_kind not null,
  status public.approval_status not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  decision jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index approval_requests_run_idx on public.approval_requests (run_id, created_at desc);
-- Only one pending approval of a kind per run.
create unique index approval_requests_pending_uidx
  on public.approval_requests (run_id, kind) where status = 'pending';

create table public.instantly_uploads (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.pipeline_runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.instantly_status not null default 'pending_approval',
  idempotency_key uuid not null unique,
  list_id text not null,
  lead_count integer not null default 0,
  uploaded_count integer,
  confirmation jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rate limiting (DB-backed so it works on serverless).
create table public.api_rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  hits integer not null default 0
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger campaigns_touch before update on public.campaigns
  for each row execute function public.touch_updated_at();
create trigger campaign_configs_touch before update on public.campaign_configs
  for each row execute function public.touch_updated_at();
create trigger pipeline_runs_touch before update on public.pipeline_runs
  for each row execute function public.touch_updated_at();
create trigger instantly_uploads_touch before update on public.instantly_uploads
  for each row execute function public.touch_updated_at();
