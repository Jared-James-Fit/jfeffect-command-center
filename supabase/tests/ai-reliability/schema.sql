-- The tables and platform pieces 20270512090000_ai_reliability.sql touches, as stubs.
\set ON_ERROR_STOP 1
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
create extension if not exists pgcrypto;
create schema if not exists net;
create table net.calls (id serial primary key, url text, body jsonb, at timestamptz default now());
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.calls (url, body) values (url, body) returning id::bigint $$;
create schema if not exists vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('cron_hook_secret', 'x');
create schema if not exists cron;
create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(_name text, _schedule text, _command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (_name, _schedule, _command) returning jobid::bigint $$;
create function cron.unschedule(_name text) returns boolean language sql as $$ delete from cron.job where jobname = _name returning true $$;

create function public.instant_to_local(_t timestamptz, _tz text) returns timestamp language sql immutable as $$ select _t at time zone _tz $$;

create table coach_automation_items (
  id uuid primary key default gen_random_uuid(), coach_user_id uuid not null default gen_random_uuid(), client_id uuid not null default gen_random_uuid(),
  category text not null default 'workout_reply', status text not null default 'queued', attempts int not null default 0, error text,
  locked_at timestamptz, due_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table coach_automation_events (id uuid primary key default gen_random_uuid(), item_id uuid, coach_user_id uuid, client_id uuid, kind text, actor uuid, detail jsonb, created_at timestamptz default now());
create table community_daily_visuals (id uuid primary key default gen_random_uuid(), day date, status text, regen text, attempts int default 0, error text, candidate jsonb, updated_at timestamptz default now());
create table community_post_decks (id uuid primary key default gen_random_uuid(), item_id uuid, post_id uuid, status text, priority int default 100, attempts int default 0,
  run_after timestamptz default now(), claimed_at timestamptz, error text, created_at timestamptz default now(), updated_at timestamptz default now());
create table coaching_lead_replies (application_id uuid primary key default gen_random_uuid(), status text, attempts int default 0, error text, created_at timestamptz default now(), updated_at timestamptz default now());
create table nutrition_ai_plans (submission_id uuid primary key default gen_random_uuid(), status text, error text, progress jsonb, updated_at timestamptz default now());
create table program_intel_jobs (id uuid primary key default gen_random_uuid(), status text, error text, updated_at timestamptz default now());
create table program_ai_edits (id uuid primary key default gen_random_uuid(), status text, error text, updated_at timestamptz default now());
create table nutrition_plan_edits (id uuid primary key default gen_random_uuid(), status text, error text, updated_at timestamptz default now());
create table program_imports (id uuid primary key default gen_random_uuid(), status text, error text, updated_at timestamptz default now());
create table nutrition_imports (id uuid primary key default gen_random_uuid(), status text, error text, updated_at timestamptz default now());
create table submission_ai_generations (id uuid primary key default gen_random_uuid(), status text, error text, created_at timestamptz default now());
create table program_intel_job_calls (created_at timestamptz, model text, stage text, ok boolean, error text, input_tokens int, output_tokens int, duration_ms int);
create table program_ai_edit_calls (created_at timestamptz, model text, stage text, ok boolean, error text, input_tokens int, output_tokens int, duration_ms int);
create table ai_credit_events (created_at timestamptz, model text, feature text, kind text, status text, input_tokens int, output_tokens int, cost_usd numeric);

insert into program_intel_job_calls values (now() - interval '20 days', 'openai:gpt-6-astra', 'strategy', true, null, 100000, 10000, 60000),
  (now() - interval '20 days', 'openai:gpt-5.5', 'construct:2 (retry)', false, '429 no credits remaining', null, null, 900);
insert into program_ai_edit_calls values (now() - interval '3 days', 'gateway:openai/gpt-5.5', 'edit', true, null, 10000, 2000, 30000);

create function t_assert(c boolean, msg text) returns text language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'ASSERT FAILED: %', msg; end if; return 'ok: ' || msg; end $$;
select 'schema ready';
