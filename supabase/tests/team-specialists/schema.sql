-- Minimal stand-ins for what 20270507090000_organizations_foundation.sql,
-- 20270603090000_specialist_login_kind.sql and
-- 20270603090100_team_specialists.sql use, plus a small team: the owner
-- (admin, business owner) with a linked athlete account, a coach, a client
-- with a login, a client with none, a JF member, and Jesse's future login.
\set ON_ERROR_STOP 1

create schema if not exists auth;
create table auth_ctx (uid uuid, role text);
insert into auth_ctx values (null, null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
create function auth.role() returns text language sql stable as $$ select role from public.auth_ctx limit 1 $$;
create function t_as(_uid uuid) returns void language sql as $$ update public.auth_ctx set uid = _uid, role = 'authenticated' $$;
create function t_as_service() returns void language sql as $$ update public.auth_ctx set uid = null, role = 'service_role' $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant select, update on auth_ctx to authenticated, anon, service_role;

create table auth.users (id uuid primary key, email text);

-- the enum as production has it before 20270603090000
create type app_role as enum ('admin', 'client', 'coach', 'media_manager', 'finance');
create table user_roles (user_id uuid references auth.users(id) on delete cascade, role app_role, is_primary boolean default false, unique (user_id, role));
-- two-step is checked inside has_role; a login with mfa_pending can't use its staff role
create table mfa_pending (user_id uuid primary key);
create function caller_mfa_ok(_uid uuid) returns boolean language sql stable security definer as $$
  select _uid is distinct from auth.uid() or not exists (select 1 from public.mfa_pending where user_id = _uid) $$;
create function has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer as $$
  select case when exists (select 1 from user_roles where user_id = _user_id and role = _role)
              then (_role = 'client' or public.caller_mfa_ok(_user_id)) else false end $$;
create function is_admin_viewer() returns boolean language sql stable as $$ select false $$;
create function tg_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create table business_owners (user_id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now());
create table profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text, email text);
create table coaches (
  id uuid primary key default gen_random_uuid(), user_id uuid unique, full_name text, email text,
  status text not null default 'Pending Invite', archived boolean not null default false
);
create table clients (
  id uuid primary key default gen_random_uuid(), user_id uuid, full_name text,
  assigned_coach_id uuid references coaches(id), archived boolean not null default false, status text
);
create table community_profiles (user_id uuid primary key, same_person_as uuid);
create function linked_client_id() returns uuid language sql stable security definer as $$
  select c.id from public.community_profiles cp join public.clients c on c.user_id = cp.same_person_as
   where cp.user_id = auth.uid() and cp.same_person_as is not null limit 1 $$;
create table pl_set_videos (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id));

create table staff_invites (
  id uuid primary key default gen_random_uuid(), email text not null, first_name text, last_name text, phone text,
  role app_role not null, setup_token text unique, setup_token_expires_at timestamptz,
  status text not null default 'pending', redeemed_user_id uuid, redeemed_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
grant execute on function t_assert(boolean, text) to authenticated;
grant execute on all functions in schema public to authenticated;

insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'owner.athlete@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'ana@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'marc@example.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'member@example.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'finance@example.test');
insert into profiles (id, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Jared Owner'),
  ('00000000-0000-0000-0000-0000000000c1', 'Ana Coach');
insert into business_owners (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'client'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach'),
  ('00000000-0000-0000-0000-0000000000d1', 'client'),
  ('00000000-0000-0000-0000-0000000000e1', 'client'),
  ('00000000-0000-0000-0000-0000000000f1', 'finance');
insert into coaches (id, user_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 'Ana Coach', 'Active');
-- the owner's staff login is linked to their own athlete account
insert into community_profiles (user_id, same_person_as) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');
insert into clients (id, user_id, full_name, assigned_coach_id) values
  ('00000000-0000-0000-0000-0000000c1e00', '00000000-0000-0000-0000-0000000000a2', 'Jared Athlete', null),
  ('00000000-0000-0000-0000-0000000c1e01', '00000000-0000-0000-0000-0000000000d1', 'Marc Client', '00000000-0000-0000-0000-00000000c0a1'),
  ('00000000-0000-0000-0000-0000000c1e02', null, 'Nico Client', null),
  ('00000000-0000-0000-0000-0000000c1e03', '00000000-0000-0000-0000-0000000000e1', 'Mia Member', null);
insert into pl_set_videos (id, client_id) values
  ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000c1e00');
