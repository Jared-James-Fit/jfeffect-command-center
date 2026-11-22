-- Minimal stand-ins for what 20270509090000_coach_platform_early_access.sql
-- uses: auth.uid(), the roles, has_role and app_settings.
\set ON_ERROR_STOP 1

create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth_ctx (uid uuid, role text);
insert into auth_ctx values (null, null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
create function t_as(_uid uuid) returns void language sql as $$ update public.auth_ctx set uid = _uid, role = 'authenticated' $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
-- as in Supabase: the server's role skips RLS
alter role service_role bypassrls;
grant usage on schema public, auth to authenticated, anon, service_role;
grant select, update on auth_ctx to authenticated, anon, service_role;

create table auth.users (id uuid primary key, email text);
create type app_role as enum ('admin', 'client', 'coach', 'finance');
create table user_roles (user_id uuid references auth.users(id) on delete cascade, role app_role, unique (user_id, role));
create function has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
grant execute on function has_role(uuid, app_role) to authenticated, anon;
grant execute on function t_as(uuid) to authenticated, anon;

create table app_settings (key text primary key, value text, updated_at timestamptz default now());
grant all on app_settings to service_role;

insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach@test'),
  ('00000000-0000-0000-0000-0000000000f1', 'member@test');
insert into user_roles values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach'),
  ('00000000-0000-0000-0000-0000000000f1', 'client');

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
grant execute on function t_assert(boolean, text) to authenticated, anon;
