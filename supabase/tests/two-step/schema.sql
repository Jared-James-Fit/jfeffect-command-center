-- Minimal stand-ins for what 20270424091500_staff_mfa.sql,
-- 20270424093000_staff_mfa_recovery.sql and 20270512090000_two_step_sms_passkeys.sql
-- read: Supabase's auth schema (users, sessions, MFA factors, the JWT) and the
-- role tables. The access token is set per test with t_token(sub, session, aal).
\set ON_ERROR_STOP 1

create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
alter role service_role bypassrls;
grant usage on schema public, auth to authenticated, anon, service_role;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function public.t_token(_sub uuid, _session uuid, _aal text default 'aal1') returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', _sub, 'session_id', _session, 'aal', _aal, 'role', 'authenticated')::text, false) $$;
create function public.t_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;

create table auth.users (id uuid primary key, email text, recovery_sent_at timestamptz,
  email_change text default '', email_change_sent_at timestamptz);
create table auth.sessions (id uuid primary key, user_id uuid references auth.users(id) on delete cascade,
  not_after timestamptz, created_at timestamptz default now());
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  factor_type text default 'totp', status text);
grant select on auth.users, auth.sessions, auth.mfa_factors to authenticated;

create type app_role as enum ('admin', 'client', 'coach', 'finance', 'member', 'media_manager');
create table user_roles (user_id uuid references auth.users(id) on delete cascade, role app_role, unique (user_id, role));
create table role_permissions (role app_role, permission text);
create table business_owners (user_id uuid primary key references auth.users(id) on delete cascade);
grant select on user_roles, role_permissions, business_owners to authenticated;

-- The team: Jared (admin, owner, an authenticator app), Fionna (finance, nothing
-- set up yet), Ana (a coach), Kai (a client). Two sessions each.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000f', 'finance@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'coach@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'client@example.com');
insert into user_roles values
  ('00000000-0000-0000-0000-00000000000a', 'admin'),
  ('00000000-0000-0000-0000-00000000000f', 'finance'),
  ('00000000-0000-0000-0000-00000000000c', 'coach'),
  ('00000000-0000-0000-0000-00000000000b', 'client');
insert into role_permissions values ('finance', 'admin.view'), ('finance', 'finance.read');
insert into business_owners values ('00000000-0000-0000-0000-00000000000a');
insert into auth.mfa_factors (user_id, status) values ('00000000-0000-0000-0000-00000000000a', 'verified');
insert into auth.sessions (id, user_id) values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a'),
  ('a2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a'),
  ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000f'),
  ('f2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000f'),
  ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c'),
  ('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b');

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin
  if _ok is distinct from true then raise exception 'ASSERT FAILED: %', _msg; end if;
  raise notice 'ok: %', _msg;
end $$;
grant execute on function t_assert(boolean, text) to authenticated, service_role, anon;
-- has_role (staff_mfa migration) names is_admin_viewer before defining it
create function public.is_admin_viewer() returns boolean language sql stable as $$ select false $$;
