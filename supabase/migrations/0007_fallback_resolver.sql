-- Manual Review Fallback Resolver: a mandatory third pipeline stage
-- (stage_one -> stage_two -> fallback_resolver -> awaiting_final_approval),
-- executed by the existing runner daemon via a new adapter that shells out to
-- the deterministic resolver in the external GTM Scoring project. See
-- docs/fallback-resolver.md for the full artifact schema and state machine.

-- New stage + run-status values. Safe to add mid-migration: these are only
-- referenced later, inside function bodies (stored as text until called) and
-- at application runtime — never used in a DML statement within this file.
alter type public.run_status add value 'fallback_resolver_running' after 'stage_two_failed';
alter type public.run_status add value 'fallback_resolver_retrying' after 'fallback_resolver_running';
alter type public.run_status add value 'fallback_resolver_failed' after 'fallback_resolver_retrying';

alter type public.stage_key add value 'fallback_resolver' after 'stage_two';

-- Shared, non-campaign-specific fallback-rules JSON (mirrors campaign_configs
-- but simpler — plain JSON, no YAML/normalized-json split).
create table public.fallback_rule_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fallback_rule_sets_user_idx on public.fallback_rule_sets (user_id, updated_at desc);
create trigger fallback_rule_sets_touch before update on public.fallback_rule_sets
  for each row execute function public.touch_updated_at();

alter table public.fallback_rule_sets enable row level security;
revoke all on public.fallback_rule_sets from anon, authenticated;
grant select on public.fallback_rule_sets to authenticated;
create policy "fallback_rule_sets: own rows" on public.fallback_rule_sets
  for select to authenticated using (user_id = (select auth.uid()));

-- Campaign-level default rule set (nullable; the adapter omits --config and
-- the resolver falls back to its own built-in defaults when unset).
alter table public.campaigns
  add column fallback_rule_set_id uuid references public.fallback_rule_sets (id) on delete set null;

-- Captured once at run creation, passed to the resolver as --allow-partial.
-- Does not change what ready_to_push.csv contains (blocked leads are always
-- excluded) — it only changes whether leftover blocked rows are a hard stop
-- (exit 2) or a warning-only pass-through in run_summary.json.
alter table public.pipeline_runs
  add column allow_partial boolean not null default false;

-- Snapshotted at run creation (defaults from campaigns.fallback_rule_set_id
-- but can be overridden per run) so a later edit to the campaign's default
-- rule set never changes what an already-launched run resolves against.
alter table public.pipeline_runs
  add column fallback_rule_set_id uuid references public.fallback_rule_sets (id) on delete set null;

-- claim_next_job: extend the running-status dispatch to a third stage, and
-- extend the resume-eligible status list so an interrupted fallback_resolver
-- run can be re-delivered to the same device. Everything else is unchanged
-- from 0004_functions.sql.
create or replace function public.claim_next_job(
  p_token_hash text,
  p_protocol_version text,
  p_resume_run_id uuid default null
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_runner public.runner_devices%rowtype;
  v_run public.pipeline_runs%rowtype;
  v_new_status public.run_status;
  v_stage public.stage_key;
begin
  select * into v_runner
    from public.runner_devices
   where token_hash = p_token_hash and status = 'active'
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'runner_not_found_or_revoked');
  end if;

  update public.runner_devices
     set last_seen_at = now(), protocol_version = p_protocol_version
   where id = v_runner.id;

  if p_resume_run_id is not null then
    select * into v_run
      from public.pipeline_runs
     where id = p_resume_run_id
       and user_id = v_runner.user_id
       and claimed_by = v_runner.id
       and status in ('queued', 'awaiting_runner',
                      'stage_one_running', 'stage_one_retrying',
                      'stage_two_running', 'stage_two_retrying',
                      'fallback_resolver_running', 'fallback_resolver_retrying',
                      'uploading_to_instantly')
     for update skip locked;
    if not found then
      return jsonb_build_object('ok', true, 'job', null);
    end if;
  else
    select * into v_run
      from public.pipeline_runs
     where user_id = v_runner.user_id
       and status in ('queued', 'awaiting_runner')
       and (claimed_by is null or claimed_by = v_runner.id)
     order by created_at asc
     for update skip locked
     limit 1;
    if not found then
      return jsonb_build_object('ok', true, 'job', null);
    end if;
  end if;

  v_stage := v_run.next_stage;
  if v_run.status in ('queued', 'awaiting_runner') then
    v_new_status := case
                       when v_stage = 'stage_two' then 'stage_two_running'::public.run_status
                       when v_stage = 'fallback_resolver' then 'fallback_resolver_running'::public.run_status
                       else 'stage_one_running'::public.run_status
                     end;
    update public.pipeline_runs
       set status = v_new_status,
           claimed_by = v_runner.id,
           current_stage = v_stage,
           started_at = coalesce(started_at, now()),
           error = null
     where id = v_run.id;

    insert into public.run_stages (run_id, user_id, stage, status, attempt, started_at)
    values (v_run.id, v_run.user_id, v_stage, 'running', 1, now())
    on conflict (run_id, stage) do update
      set status = 'running', attempt = public.run_stages.attempt + 1,
          started_at = now(), ended_at = null, error = null;
  else
    v_new_status := v_run.status;
    v_stage := coalesce(v_run.current_stage, v_run.next_stage);
  end if;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'run_id', v_run.id,
      'campaign_id', v_run.campaign_id,
      'config_id', v_run.config_id,
      'user_id', v_run.user_id,
      'stage', v_stage,
      'status', v_new_status,
      'mock', v_run.mock,
      'source', v_run.source,
      'directive', v_run.directive,
      'lead_count', v_run.lead_count,
      'resumed', p_resume_run_id is not null
    )
  );
end;
$$;

revoke all on function public.claim_next_job(text, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_next_job(text, text, uuid) to service_role;
