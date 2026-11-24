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
  assigned_coach_id uuid references coaches(id),
  timezone text default 'America/Winnipeg',
  committed_training_days text[] default '{}',
  preferred_high_days text[] default '{}',
  archived boolean not null default false,
  status text default 'Active'
);
create function coached_client_ids() returns setof uuid language sql stable security definer as $$
  select c.id from clients c join coaches co on co.id = c.assigned_coach_id
   where co.user_id = auth.uid() and co.archived = false and co.status = 'Active' $$;
alter table clients enable row level security;
create policy "staff read clients" on clients for select to authenticated
  using (has_role(auth.uid(), 'admin') or id in (select coached_client_ids()) or user_id = auth.uid());
grant select on clients to authenticated;

-- the client's own day, fixed for the test
create table test_today (d date);
insert into test_today values ('2026-11-23');
create function pt_local_today(tz text) returns date language sql stable as $$ select d from public.test_today limit 1 $$;

-- cardio_targets and cardio_completions as they were before 20270115090000
create table cardio_targets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  admin_notes text, calorie_target_max int, calorie_target_min int, calorie_target_mode text not null default 'auto',
  cardio_type text not null default 'Treadmill', client_notes text, completion_rule text not null default 'any_target',
  created_at timestamptz not null default now(), custom_day_type text, custom_type text, day_type text not null default 'General',
  duration_minutes int, enabled boolean not null default true, end_date date, ending_soon_days int not null default 7,
  frequency_per_week int, goal text, heart_rate_zone text, incline numeric, intensity text,
  last_updated_at timestamptz not null default now(), machine_preference text, phase_id uuid, program_name text,
  scheduled_weekdays text[] not null default '{}', show_calories_to_client boolean not null default true,
  speed_max_mph numeric, speed_min_mph numeric, start_date date not null, status text not null default 'Active',
  step_target int, step_target_mode text not null default 'auto', updated_at timestamptz not null default now(),
  visible_to_client boolean not null default true
);
create table cardio_completions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  cardio_target_id uuid references cardio_targets(id) on delete set null,
  completed_date date not null, completed boolean not null default true, skipped boolean not null default false,
  duration_minutes int, cardio_type text, rpe numeric, calories int, incline numeric, day_type text,
  completion_target text, updated_at timestamptz default now(), created_at timestamptz default now(),
  unique (client_id, cardio_target_id, completed_date)
);
create table exercises (id uuid primary key default gen_random_uuid(), name text, archived boolean default false, created_at timestamptz default now());
insert into exercises (name) values ('Treadmill Walk'), ('Stationary Exercise Bike'), ('Walking Fast'), ('Cardio');
create table pl_blocks (id uuid primary key default gen_random_uuid(), client_id uuid, client_visible boolean default true, archived boolean default false,
  status text default 'Active', source_template_block_key text, start_date date, end_date date);
create table pl_weeks (id uuid primary key default gen_random_uuid(), block_id uuid references pl_blocks(id), deleted_at timestamptz);
create table pl_days (id uuid primary key default gen_random_uuid(), week_id uuid references pl_weeks(id), archived boolean default false,
  deleted_at timestamptz, scheduled_date date);
create table pl_exercise_rows (id uuid primary key default gen_random_uuid(), day_id uuid references pl_days(id) on delete cascade, sort_order int,
  exercise_id uuid, exercise_name_override text, sets int, reps_text text, rpe numeric, rest_seconds int, measurement_type text,
  tracking_type text, time_profile text, duration_seconds int, notes text, purpose_label text);
create table pl_scheduled_workouts (id uuid primary key default gen_random_uuid(), source_day_id uuid, scheduled_date date);
create table pl_day_completions (id uuid primary key default gen_random_uuid(), day_id uuid, completed_at timestamptz, started_at timestamptz, in_progress_at timestamptz);
create table pl_row_results (id uuid primary key default gen_random_uuid(), row_id uuid, scheduled_workout_id uuid, completed_duration_seconds int,
  completed_at timestamptz, actual_rpe_num numeric, actual_calories int);

-- A coach (Ana) with Marc, another coach (Ben) with Nico, the owner.
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'ana@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'ben@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'marc@example.test');
insert into user_roles values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach'),
  ('00000000-0000-0000-0000-0000000000c2', 'coach'),
  ('00000000-0000-0000-0000-0000000000d1', 'client');
insert into coaches (id, user_id, full_name) values
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 'Ana Coach'),
  ('00000000-0000-0000-0000-00000000c0b2', '00000000-0000-0000-0000-0000000000c2', 'Ben Coach');
insert into clients (id, user_id, full_name, assigned_coach_id, committed_training_days) values
  ('00000000-0000-0000-0000-0000000c1e01', '00000000-0000-0000-0000-0000000000d1', 'Marc Client', '00000000-0000-0000-0000-00000000c0a1', '{Monday,Wednesday,Friday}'),
  ('00000000-0000-0000-0000-0000000c1e02', null, 'Nico Client', '00000000-0000-0000-0000-00000000c0b2', '{}');

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
grant execute on function t_assert(boolean, text) to authenticated, anon;
