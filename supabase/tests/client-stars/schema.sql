-- Minimal stand-ins for what 20270519090000_staff_client_stars.sql uses:
-- auth.uid() / auth.users, the roles, user_roles + has_role, coaches, clients
-- (with the coach's read rule) and coached_client_ids().
\set ON_ERROR_STOP 1

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
grant usage on schema public, auth to authenticated, anon, service_role;
grant select, update on auth_ctx to authenticated, anon, service_role;
grant execute on function t_as(uuid) to authenticated, anon;

create table auth.users (id uuid primary key, email text);

create type app_role as enum ('admin', 'client', 'coach', 'finance');
create table user_roles (user_id uuid references auth.users(id) on delete cascade, role app_role, unique (user_id, role));
create function has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;

create table coaches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique, full_name text,
  status text not null default 'Active',
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
alter table clients enable row level security;
create policy "staff read clients" on clients for select to authenticated
  using (has_role(auth.uid(), 'admin') or id in (select coached_client_ids()) or user_id = auth.uid());
grant select on clients to authenticated;

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
grant execute on function t_assert(boolean, text) to authenticated, anon;

-- The owner (admin), two active coaches, a suspended coach, a client of each
-- coach, and a client with a login.
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'ana@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'ben@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'sus@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'marc@example.test');
insert into user_roles values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach'),
  ('00000000-0000-0000-0000-0000000000c2', 'coach'),
  ('00000000-0000-0000-0000-0000000000c3', 'coach'),
  ('00000000-0000-0000-0000-0000000000d1', 'client');
insert into coaches (id, user_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 'Ana Coach', 'Active'),
  ('00000000-0000-0000-0000-00000000c0b2', '00000000-0000-0000-0000-0000000000c2', 'Ben Coach', 'Active'),
  ('00000000-0000-0000-0000-00000000c0c3', '00000000-0000-0000-0000-0000000000c3', 'Sus Coach', 'Suspended');
insert into clients (id, user_id, full_name, assigned_coach_id) values
  ('00000000-0000-0000-0000-0000000c1e01', '00000000-0000-0000-0000-0000000000d1', 'Marc Client', '00000000-0000-0000-0000-00000000c0a1'),
  ('00000000-0000-0000-0000-0000000c1e02', null, 'Nico Client', '00000000-0000-0000-0000-00000000c0b2'),
  ('00000000-0000-0000-0000-0000000c1e03', null, 'Sam Suspended', '00000000-0000-0000-0000-00000000c0c3');
