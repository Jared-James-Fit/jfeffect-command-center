-- Minimal stand-ins for what 20270601095000_goal_intelligence.sql reads and
-- writes: the auth context, roles, clients (with their bodyweight goal),
-- competitions, the intel profile, settings, and the tables goal_intel_due()
-- looks at. A coach (Ana) with one client (Sam, who has a login), a second
-- coach (Ben) with none, and an admin.
\set ON_ERROR_STOP 1

create schema if not exists auth;
create table auth_ctx (uid uuid, role text);
insert into auth_ctx values (null, null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
create function t_as(_uid uuid) returns void language sql as $$ update public.auth_ctx set uid = _uid, role = 'authenticated' $$;
create function t_as_service() returns void language sql as $$ update public.auth_ctx set uid = null, role = 'service_role' $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
alter role service_role bypassrls;
grant usage on schema public, auth to authenticated, anon, service_role;
grant select, update on auth_ctx to authenticated, anon, service_role;

create type app_role as enum ('admin', 'client', 'coach', 'finance');
create table user_roles (user_id uuid, role app_role, unique (user_id, role));
create function has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;
create table coaches (id uuid primary key default gen_random_uuid(), user_id uuid unique);
create table clients (
  id uuid primary key default gen_random_uuid(), user_id uuid, first_name text, archived boolean not null default false,
  service_tier text not null default 'coaching', assigned_coach_id uuid references coaches(id),
  preferred_weight_unit text not null default 'lb',
  bodyweight_goal_type text check (bodyweight_goal_type in ('lose','gain','maintain','performance_cut','custom')),
  bodyweight_goal_value numeric, bodyweight_goal_value_max numeric,
  bodyweight_goal_unit text check (bodyweight_goal_unit in ('lb','kg')), bodyweight_goal_date date, bodyweight_goal_set_at timestamptz);
create function coached_client_ids() returns setof uuid language sql stable security definer as $$
  select c.id from public.clients c join public.coaches k on k.id = c.assigned_coach_id where k.user_id = auth.uid() $$;
create table competitions (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references clients(id) on delete cascade,
  name text not null, meet_date date not null, status text not null default 'upcoming',
  target_total_kg numeric, athlete_goal_total_kg numeric);
create table program_intel_profiles (
  client_id uuid primary key references clients(id) on delete cascade, long_term_goal jsonb,
  updated_by uuid default auth.uid(), updated_at timestamptz not null default now());
create table app_settings (key text unique not null, value text); -- text holding JSON, as in production
create table coaching_sessions (id uuid primary key default gen_random_uuid(), client_id uuid, analysis_status text, updated_at timestamptz not null default now());
create table messenger_checkins (id uuid primary key default gen_random_uuid(), client_id uuid, task_type text, status text, submitted_at timestamptz);
create table messages (id uuid primary key default gen_random_uuid(), client_id uuid, sender_role text, created_at timestamptz not null default now());
create function instant_to_local(_at timestamptz, _tz text) returns timestamp language sql immutable as $$ select _at at time zone _tz $$;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;

-- the team and the clients
insert into coaches (id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a0a1'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000b0b1');
insert into user_roles values
  ('00000000-0000-0000-0000-00000000a0a1', 'coach'), ('00000000-0000-0000-0000-00000000b0b1', 'coach'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin'), ('00000000-0000-0000-0000-00000000c0c1', 'client');
insert into clients (id, user_id, first_name, assigned_coach_id, bodyweight_goal_type, bodyweight_goal_value, bodyweight_goal_unit) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c0c1', 'Sam', '00000000-0000-0000-0000-0000000000a1', 'lose', 65, 'kg'),
  ('00000000-0000-0000-0000-0000000000c2', null, 'Lee', '00000000-0000-0000-0000-0000000000a1', null, null, null);
insert into program_intel_profiles (client_id, long_term_goal) values
  ('00000000-0000-0000-0000-0000000000c1', '{"text": "Qualify for nationals", "date": "2027-03-06", "savedAt": "2026-11-19T17:24:52Z"}');
insert into competitions (id, client_id, name, meet_date, target_total_kg) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-0000000000c1', 'Winter Open', '2026-12-05', null),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-0000000000c1', 'Spring Classic', '2027-04-10', 300);
