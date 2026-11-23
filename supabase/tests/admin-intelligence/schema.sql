-- The tables and platform pieces 20270517090000_admin_intelligence.sql reads, as stubs.
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
create function cron.unschedule(_id bigint) returns boolean language sql as $$ delete from cron.job where jobid = _id returning true $$;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());

create function public.instant_to_local(_t timestamptz, _tz text) returns timestamp language sql immutable as $$ select _t at time zone _tz $$;
create function public.local_to_instant(_t timestamp, _tz text) returns timestamptz language sql immutable as $$ select _t at time zone _tz $$;
create function public.is_test_login(_uid uuid) returns boolean language sql stable as $$
  select coalesce((select lower(split_part(email, '@', 2)) = 'example.com' from auth.users where id = _uid), false) $$;

create type public.app_role as enum ('admin', 'coach', 'client', 'finance');
create table public.user_roles (user_id uuid, role public.app_role);
create table public.community_series_settings (author_user_id uuid);
create table public.community_profiles (user_id uuid, same_person_as uuid);
create function public.community_staff_people() returns setof uuid language sql stable as $$
  select user_id from public.user_roles where role in ('admin', 'coach') $$;
create table public.app_settings (id uuid primary key default gen_random_uuid(), key text unique, value text, updated_at timestamptz default now());
create table public.ai_provider_health (provider text primary key, status text default 'ok', next_probe_at timestamptz);
create table public.community_post_decks (id uuid primary key default gen_random_uuid(), status text, priority int default 100,
  run_after timestamptz default now(), claimed_at timestamptz, created_at timestamptz default now());
create table public.ai_call_log (id uuid primary key default gen_random_uuid(), at timestamptz default now(), provider text default 'openai',
  model text, task text, feature text, ok boolean, failure text, error text, input_tokens int, cached_tokens int, output_tokens int,
  reasoning_tokens int, ms int, cost_usd numeric);
create table public.sms_log (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), category text, kind text,
  status text, twilio_sid text, twilio_status text, blocked_reason text, segments int, price_usd numeric, est_cost_usd numeric);
create table public.clients (id uuid primary key default gen_random_uuid(), user_id uuid, service_tier text default 'coaching', status text,
  archived boolean default false, created_at timestamptz default now(), archived_at timestamptz, deactivated_at timestamptz,
  converted_to_client_at timestamptz, account_created_at timestamptz, full_name text, email text, last_active_at timestamptz);
create table public.client_activity_log (id uuid primary key default gen_random_uuid(), client_id uuid, actor_user_id uuid, action text, created_at timestamptz default now());
create table public.membership_funnel_events (id bigserial, day date, visitor_id uuid, event text, step text default '', source text,
  referrer_host text, utm_source text, device text);
create table public.pl_day_completions (id uuid primary key default gen_random_uuid(), client_id uuid, completed_at timestamptz);
create table public.messages (id uuid primary key default gen_random_uuid(), sender_id uuid, sender_role text, created_at timestamptz default now());
create table public.community_post_views (post_id uuid, viewer_user_id uuid, viewed_at timestamptz default now());
create table public.community_posts (id uuid primary key default gen_random_uuid(), author_user_id uuid, created_at timestamptz default now());
create table public.community_reactions (post_id uuid, user_id uuid, created_at timestamptz default now());
create table public.community_comments (id uuid primary key default gen_random_uuid(), author_user_id uuid, created_at timestamptz default now());
create table public.progress_bodyweight (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now());
create table public.progress_water_entries (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now());
create table public.messenger_checkins (id uuid primary key default gen_random_uuid(), client_id uuid, submitted_at timestamptz);
create table public.pl_set_videos (id uuid primary key default gen_random_uuid(), client_id uuid, created_at timestamptz default now(), deleted_at timestamptz);
create table public.member_meal_logs (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now());
create table public.athlete_programs (id uuid primary key default gen_random_uuid(), owner_id uuid, created_at timestamptz default now());
create table public.push_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid, platform text, enabled boolean default true);
create table public.membership_applications (id uuid primary key default gen_random_uuid(), is_test boolean default false, status text,
  created_at timestamptz default now(), decided_at timestamptz, activated_at timestamptz, full_name text, goal text, coaching_interest text);
create table public.app_members (id uuid primary key default gen_random_uuid(), user_id uuid, account_type text default 'jf_member',
  subscription_status text, stripe_subscription_id text, is_admin_sandbox boolean default false, setup_completed_at timestamptz,
  manual_access_disabled boolean default false, created_at timestamptz default now());
create function public.member_setup_complete(_member_id uuid) returns boolean language sql stable as $$
  select setup_completed_at is not null from public.app_members where id = _member_id $$;
create table public.ai_credit_purchases (id uuid primary key default gen_random_uuid(), status text, amount_minor int, refunded_minor int default 0, paid_at timestamptz);
create table public.member_plans (id uuid primary key default gen_random_uuid(), status text);
create table public.pl_blocks (id uuid primary key default gen_random_uuid(), client_id uuid, archived boolean default false);
create table public.coaching_applications (id uuid primary key default gen_random_uuid(), is_test boolean default false, created_at timestamptz default now());
create table public.payment_ledger (id uuid primary key default gen_random_uuid(), client_id uuid, txn_type text, amount_minor bigint, tax_minor bigint,
  transaction_date date default current_date, voided boolean default false);
create table public.purchase_records (id uuid primary key default gen_random_uuid(), stripe_subscription_id text, archived_at timestamptz,
  stripe_subscription_status text, cancel_at_period_end boolean default false);

create table public.account_lifecycle_events (id uuid primary key default gen_random_uuid(), client_id uuid, user_id uuid,
  event text not null constraint account_lifecycle_events_event_check check (event in ('deactivated', 'reactivated')),
  actor_user_id uuid, actor_role text, details jsonb default '{}', created_at timestamptz default now());
create function t_assert(c boolean, msg text) returns text language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'ASSERT FAILED: %', msg; end if; return 'ok: ' || msg; end $$;
select 'schema ready';
