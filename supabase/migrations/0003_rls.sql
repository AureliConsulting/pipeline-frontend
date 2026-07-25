-- Row Level Security.
--
-- Model: the browser (anon/authenticated roles) is READ-ONLY on all
-- application data. Every write — campaign creation, uploads, approvals,
-- runner events — goes through Next.js server routes using the service-role
-- key, which validate ownership and state transitions in code. This makes it
-- impossible for a browser client to update trusted execution fields
-- (statuses, claimed_by, artifact verification, Instantly completion) or to
-- reassign a record's owner: there is no UPDATE/INSERT grant to abuse.
--
-- SELECT policies scope every table to auth.uid() = user_id, so a user can
-- never read (or infer the existence of) another user's rows — including via
-- Supabase Realtime, which enforces the same policies.

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_configs enable row level security;
alter table public.runner_devices enable row level security;
alter table public.runner_pairing_codes enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.run_stages enable row level security;
alter table public.run_events enable row level security;
alter table public.artifacts enable row level security;
alter table public.runner_heartbeats enable row level security;
alter table public.approval_requests enable row level security;
alter table public.instantly_uploads enable row level security;
alter table public.api_rate_limits enable row level security;

-- Remove default grants, then grant read-only access explicitly.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

grant select on
  public.profiles,
  public.campaigns,
  public.campaign_configs,
  public.runner_devices,
  public.pipeline_runs,
  public.run_stages,
  public.run_events,
  public.artifacts,
  public.runner_heartbeats,
  public.approval_requests,
  public.instantly_uploads
to authenticated;

-- anon gets nothing. runner_pairing_codes and api_rate_limits are service-only.

create policy "profiles: own row" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "campaigns: own rows" on public.campaigns
  for select to authenticated using (user_id = (select auth.uid()));

create policy "campaign_configs: own rows" on public.campaign_configs
  for select to authenticated using (user_id = (select auth.uid()));

create policy "runner_devices: own rows" on public.runner_devices
  for select to authenticated using (user_id = (select auth.uid()));

create policy "pipeline_runs: own rows" on public.pipeline_runs
  for select to authenticated using (user_id = (select auth.uid()));

create policy "run_stages: own rows" on public.run_stages
  for select to authenticated using (user_id = (select auth.uid()));

create policy "run_events: own rows" on public.run_events
  for select to authenticated using (user_id = (select auth.uid()));

create policy "artifacts: own rows" on public.artifacts
  for select to authenticated using (user_id = (select auth.uid()));

create policy "runner_heartbeats: own rows" on public.runner_heartbeats
  for select to authenticated using (user_id = (select auth.uid()));

create policy "approval_requests: own rows" on public.approval_requests
  for select to authenticated using (user_id = (select auth.uid()));

create policy "instantly_uploads: own rows" on public.instantly_uploads
  for select to authenticated using (user_id = (select auth.uid()));

-- Realtime: same RLS applies to change events.
alter publication supabase_realtime add table public.pipeline_runs;
alter publication supabase_realtime add table public.run_stages;
alter publication supabase_realtime add table public.run_events;
alter publication supabase_realtime add table public.runner_devices;
alter publication supabase_realtime add table public.approval_requests;
