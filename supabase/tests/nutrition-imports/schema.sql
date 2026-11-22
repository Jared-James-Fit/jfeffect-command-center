-- Stand-ins for what 20270508091000_nutrition_imports.sql uses: Supabase's
-- auth and storage, the AI credit helpers it redefines around, a plan table
-- for the saved-plan link, and two members. pg_net, vault and pg_cron are
-- left out on purpose: the queue trigger and the cron block must never fail
-- a write without them.
\set ON_ERROR_STOP 1
create schema if not exists auth;
create table auth_ctx (uid uuid);
insert into auth_ctx values (null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
create function t_as(_uid uuid) returns void language sql as $$ update public.auth_ctx set uid = _uid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant select, update on auth_ctx to authenticated, anon;
create table auth.users (id uuid primary key);

-- Supabase's default: every table in public is granted to anon and authenticated (RLS decides)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

-- storage
create schema if not exists storage;
grant usage on schema storage to authenticated, anon, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, anon;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to authenticated, anon;

-- the plan a member's import becomes
create table nutrition_targets (id uuid primary key default gen_random_uuid(), client_id uuid);

-- AI credits as 20270313090000_ai_credits.sql leaves them (only what ai_credit_state reads)
create table ai_credit_wallets (user_id uuid primary key, period_start date, period_used int default 0, extra int default 0);
create function ai_credit_tier(_user uuid) returns text language sql stable as $$ select 'member' $$;
create function ai_credit_allowance(_user uuid) returns int language sql stable as $$ select 30 $$;
create function ai_credit_period_start() returns date language sql stable as $$ select date_trunc('month', now())::date $$;
create function ai_credit_cost(_feature text) returns integer language sql immutable as $$
  select case _feature when 'meal_estimate' then 1 when 'program_import' then 10 else null end $$;

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
grant execute on function t_assert(boolean, text), t_as(uuid) to authenticated, anon;

insert into auth.users values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2'), ('00000000-0000-0000-0000-0000000000c1');
