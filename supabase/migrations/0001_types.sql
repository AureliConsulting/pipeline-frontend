-- Aureli Campaign Console — schema types.
-- Status values are the single typed source of truth in the database and are
-- kept in sync with packages/shared/protocol.json (protocol test asserts parity).

create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

create type public.run_status as enum (
  'draft',
  'awaiting_runner',
  'queued',
  'stage_one_running',
  'stage_one_retrying',
  'stage_one_failed',
  'awaiting_stage_one_approval',
  'stage_two_running',
  'stage_two_retrying',
  'stage_two_failed',
  'awaiting_final_approval',
  'uploading_to_instantly',
  'completed',
  'completed_with_warnings',
  'cancelled'
);

create type public.stage_key as enum ('stage_one', 'stage_two', 'instantly_upload');

create type public.stage_status as enum ('pending', 'running', 'retrying', 'failed', 'completed', 'skipped');

create type public.event_severity as enum ('debug', 'info', 'warn', 'error');

create type public.input_type as enum ('csv', 'sales_navigator');

create type public.runner_status as enum ('active', 'revoked');

create type public.approval_kind as enum ('stage_one', 'final', 'failure_decision');

create type public.approval_status as enum ('pending', 'decided', 'cancelled');

create type public.instantly_status as enum (
  'pending_approval', 'approved', 'uploading', 'completed', 'failed', 'cancelled'
);
