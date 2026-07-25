-- Explicit service_role grants.
--
-- Managed Supabase projects wire these up automatically at project
-- creation; a plain self-hosted/CLI Postgres instance does not, so
-- service_role starts with no SELECT/INSERT/UPDATE/DELETE on tables we
-- create ourselves (only whatever narrow defaults happened to exist).
-- Every write in this app goes through server routes using service_role
-- (see 0003_rls.sql), so it needs full access to the public schema —
-- RLS does not apply to service_role in the first place (it's the
-- privileged role), but the underlying GRANTs are still required.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Keep future tables/sequences/functions (from later migrations) covered too.
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
