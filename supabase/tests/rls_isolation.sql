-- RLS isolation test. Run against a LOCAL dev database only:
--   supabase db reset            (applies migrations)
--   psql "$(supabase status -o json | jq -r .DB_URL)" -f supabase/tests/rls_isolation.sql
-- Every statement raises an exception (failing the script) if isolation breaks.

begin;

-- Two fake users directly in auth.users (local dev only).
insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ali@test.local'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'julian@test.local')
on conflict (id) do nothing;

-- The profiles trigger fires on insert; make sure rows exist either way.
insert into public.profiles (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ali@test.local'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'julian@test.local')
on conflict (id) do nothing;

insert into public.campaigns (id, user_id, title, input_type, max_leads) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Ali Campaign', 'csv', 100),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Julian Campaign', 'csv', 100);

insert into public.pipeline_runs (id, user_id, campaign_id, status) values
  ('31111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'queued'),
  ('32222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'queued');

insert into public.artifacts (run_id, user_id, stage, artifact_type, file_name, storage_path) values
  ('31111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'stage_one', 'source_csv', 'a.csv', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/31111111-1111-4111-8111-111111111111/stage_one/a.csv'),
  ('32222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'stage_one', 'source_csv', 'b.csv', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/32222222-2222-4222-8222-222222222222/stage_one/b.csv');

insert into public.runner_devices (id, user_id, name, token_hash) values
  ('41111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ali-pc', 'hash-a'),
  ('42222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'julian-pc', 'hash-b');

-- ============================ act as Ali ============================
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

do $$
declare n integer;
begin
  select count(*) into n from public.campaigns;
  if n <> 1 then raise exception 'RLS FAIL: Ali sees % campaigns (expected 1)', n; end if;
  select count(*) into n from public.campaigns where title = 'Julian Campaign';
  if n <> 0 then raise exception 'RLS FAIL: Ali can see Julian''s campaign'; end if;
  select count(*) into n from public.pipeline_runs;
  if n <> 1 then raise exception 'RLS FAIL: Ali sees % runs (expected 1)', n; end if;
  select count(*) into n from public.artifacts;
  if n <> 1 then raise exception 'RLS FAIL: Ali sees % artifacts (expected 1)', n; end if;
  select count(*) into n from public.runner_devices;
  if n <> 1 then raise exception 'RLS FAIL: Ali sees % runners (expected 1)', n; end if;
end $$;

-- Ali must not be able to write anything (read-only grants):
do $$
begin
  begin
    update public.pipeline_runs set status = 'completed'
      where id = '31111111-1111-4111-8111-111111111111';
    raise exception 'RLS FAIL: browser role could update a trusted run status';
  exception
    when insufficient_privilege then null; -- expected
  end;
  begin
    update public.campaigns set user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      where id = '22222222-2222-4222-8222-222222222222';
    raise exception 'RLS FAIL: browser role could steal a record by changing owner';
  exception
    when insufficient_privilege then null; -- expected
  end;
  begin
    insert into public.campaigns (user_id, title, input_type, max_leads)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'X', 'csv', 10);
    raise exception 'RLS FAIL: browser role could insert directly';
  exception
    when insufficient_privilege then null; -- expected
  end;
end $$;

-- ============================ act as anon ============================
set local role anon;
set local request.jwt.claims = '{}';
do $$
declare n integer;
begin
  begin
    select count(*) into n from public.campaigns;
    if n <> 0 then raise exception 'RLS FAIL: anon sees campaigns'; end if;
  exception
    when insufficient_privilege then null; -- no grant at all is also fine
  end;
end $$;

reset role;
select 'RLS isolation checks passed' as result;
rollback;
