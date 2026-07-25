-- Server-side functions. All are called ONLY from Next.js server routes using
-- the service-role connection. They exist to make multi-step operations
-- atomic. EXECUTE is revoked from PUBLIC/anon/authenticated at the end of
-- this file (Postgres grants EXECUTE to PUBLIC by default on new functions).

-- Atomic single-use pairing-code consumption.
create or replace function public.consume_pairing_code(p_code_hash text)
returns uuid
language sql
security definer set search_path = public
as $$
  update public.runner_pairing_codes
     set used_at = now()
   where code_hash = p_code_hash
     and used_at is null
     and expires_at > now()
  returning user_id;
$$;

-- DB-backed fixed-window rate limiter (works across serverless instances).
create or replace function public.check_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_hits integer;
begin
  insert into public.api_rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set window_start = case
          when r.window_start < now() - make_interval(secs => p_window_seconds) then now()
          else r.window_start
        end,
        hits = case
          when r.window_start < now() - make_interval(secs => p_window_seconds) then 1
          else r.hits + 1
        end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- Atomic job claim. Exactly one runner can claim a given run:
-- FOR UPDATE SKIP LOCKED serializes concurrent claimers, and claimed_by pins
-- the run to a single device afterwards. A runner can only ever receive runs
-- belonging to its own user (scoped by runner_devices.user_id).
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
    -- Resume path: re-deliver a run this device already claimed, whatever
    -- running/retrying state it was left in. Never another user's run and
    -- never a run claimed by a different device.
    select * into v_run
      from public.pipeline_runs
     where id = p_resume_run_id
       and user_id = v_runner.user_id
       and claimed_by = v_runner.id
       and status in ('queued', 'awaiting_runner',
                      'stage_one_running', 'stage_one_retrying',
                      'stage_two_running', 'stage_two_retrying',
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
    v_new_status := case when v_stage = 'stage_two' then 'stage_two_running'::public.run_status
                         else 'stage_one_running'::public.run_status end;
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
    -- Resume of an in-flight run: leave status as-is.
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

-- Idempotent batched event append. UNIQUE (run_id, seq) makes runner retries
-- safe; only genuinely-new events are stored. Also maintains the denormalized
-- progress blob and trims the live-event window (full logs live in a private
-- storage artifact, not in Postgres).
create or replace function public.append_run_events(
  p_run_id uuid,
  p_events jsonb,
  p_retain integer default 500
) returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid;
  v_inserted integer := 0;
  v_last jsonb;
  v_max_seq bigint;
begin
  select user_id into v_user from public.pipeline_runs where id = p_run_id;
  if not found then
    raise exception 'run not found';
  end if;

  with new_events as (
    insert into public.run_events (
      run_id, user_id, seq, stage, ts, severity, event_type, message,
      current_item, total_items, exa_query_count, retry_count, cost_usd, metadata
    )
    select
      p_run_id, v_user,
      (e->>'seq')::bigint,
      (e->>'stage')::public.stage_key,
      (e->>'ts')::timestamptz,
      (e->>'severity')::public.event_severity,
      e->>'event_type',
      left(e->>'message', 2000),
      nullif(e->>'current_item', '')::integer,
      nullif(e->>'total_items', '')::integer,
      nullif(e->>'exa_query_count', '')::integer,
      nullif(e->>'retry_count', '')::integer,
      nullif(e->>'cost_usd', '')::numeric,
      e->'metadata'
    from jsonb_array_elements(p_events) as e
    on conflict (run_id, seq) do nothing
    returning 1
  )
  select count(*) into v_inserted from new_events;

  select max(seq) into v_max_seq from public.run_events where run_id = p_run_id;

  -- Latest progress-bearing event drives the denormalized progress blob.
  select to_jsonb(t) into v_last
  from (
    select current_item, total_items, exa_query_count, retry_count, cost_usd, stage, ts
      from public.run_events
     where run_id = p_run_id and event_type = 'stage_progress'
     order by seq desc limit 1
  ) t;

  update public.pipeline_runs
     set last_event_seq = coalesce(v_max_seq, last_event_seq),
         progress = coalesce(v_last, progress)
   where id = p_run_id;

  -- Trim: keep only the most recent p_retain events per run in Postgres.
  delete from public.run_events
   where run_id = p_run_id
     and seq < coalesce(v_max_seq, 0) - p_retain;

  return v_inserted;
end;
$$;

-- Lock down: these functions are service-role-only. Default EXECUTE goes to
-- PUBLIC on creation, so revoke explicitly (service_role keeps access).
revoke all on function public.consume_pairing_code(text) from public, anon, authenticated;
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_next_job(text, text, uuid) from public, anon, authenticated;
revoke all on function public.append_run_events(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.consume_pairing_code(text) to service_role;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.claim_next_job(text, text, uuid) to service_role;
grant execute on function public.append_run_events(uuid, jsonb, integer) to service_role;
