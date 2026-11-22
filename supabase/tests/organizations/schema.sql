-- Minimal stand-ins for the tables and helpers that
-- 20270507090000_organizations_foundation.sql and
-- 20270507091000_team_access_hardening.sql use, plus the team as it stands
-- before they run (so their backfills have something real to act on).
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
grant select on auth_ctx to authenticated, anon, service_role;

create table auth.users (id uuid primary key, email text);

create type app_role as enum ('admin', 'client', 'coach', 'finance');
create table user_roles (user_id uuid references auth.users(id) on delete cascade, role app_role, is_primary boolean default false, unique (user_id, role));
create function has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create function caller_mfa_ok(_uid uuid) returns boolean language sql stable as $$ select true $$;
create function is_admin_viewer() returns boolean language sql stable as $$ select false $$;
grant execute on all functions in schema public to authenticated;

create table business_owners (user_id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now());
create table profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text, email text);

create table coaches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  full_name text, email text,
  status text not null default 'Pending Invite',
  archived boolean not null default false
);
create table clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, full_name text,
  assigned_coach_id uuid references coaches(id)
);
create function coached_client_ids() returns setof uuid language sql stable security definer as $$
  select c.id from clients c join coaches co on co.id = c.assigned_coach_id
   where co.user_id = auth.uid() and co.archived = false and co.status = 'Active' $$;

create table purchase_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  term_start_date date, term_end_date date, package_expiry_date date,
  term_date_history jsonb, term_auto_calculated boolean,
  term_length_snapshot int, term_unit_snapshot text,
  updated_at timestamptz default now()
);

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
grant execute on function t_assert(boolean, text) to authenticated;

-- The team before the migrations: the owner (admin + business owner), an
-- active coach, a coach the admin suspended who still holds the role (the
-- bug), the finance login and a JF member.
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'ana@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'ben@example.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'finance@example.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'member@example.test');
insert into profiles (id, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Jared Owner'),
  ('00000000-0000-0000-0000-0000000000c1', 'Ana Coach'),
  ('00000000-0000-0000-0000-0000000000c2', 'Ben Coach');
insert into business_owners (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach'),
  ('00000000-0000-0000-0000-0000000000c2', 'coach'),
  ('00000000-0000-0000-0000-0000000000f1', 'finance'),
  ('00000000-0000-0000-0000-0000000000e1', 'client');
insert into coaches (id, user_id, full_name, email, status) values
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 'Ana Coach', 'ana@example.test', 'Active'),
  ('00000000-0000-0000-0000-00000000c0b2', '00000000-0000-0000-0000-0000000000c2', 'Ben Coach', 'ben@example.test', 'Suspended');
insert into clients (id, user_id, full_name, assigned_coach_id) values
  ('00000000-0000-0000-0000-0000000c1e01', null, 'Marc Client', '00000000-0000-0000-0000-00000000c0a1'),
  ('00000000-0000-0000-0000-0000000c1e02', null, 'Nico Client', null),
  ('00000000-0000-0000-0000-0000000c1e03', '00000000-0000-0000-0000-0000000000e1', 'Mia Member', null);
insert into purchase_records (id, client_id) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000c1e01'),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-0000000c1e02');
