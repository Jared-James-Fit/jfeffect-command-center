-- Stand-ins for the tables the Hall of Strength migrations read.
-- Plain Postgres 16; the supabase roles must exist (see README).
create schema auth;
create table auth_ctx (uid uuid);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
create type app_role as enum ('admin', 'coach', 'client');
create table user_roles (user_id uuid, role app_role);
create function has_role(_user_id uuid, _role app_role) returns boolean language sql stable as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create function league_tz() returns text language sql immutable as $$ select 'America/Winnipeg'::text $$;
create function league_is_staff() returns boolean language sql stable as $$
  select auth.uid() is not null and (has_role(auth.uid(), 'admin') or has_role(auth.uid(), 'coach')) $$;
create function portal_viewer_uid(_as_user uuid) returns uuid language sql stable as $$ select coalesce(_as_user, auth.uid()) $$;
create function community_is_coach(_user_id uuid) returns boolean language sql stable as $$ select has_role(_user_id, 'admin') $$;

create table clients (id uuid primary key default gen_random_uuid(), user_id uuid default gen_random_uuid(),
  first_name text, last_name text, full_name text, archived boolean default false, archived_at timestamptz,
  status text, sex text, created_at timestamptz default now());
create table profiles (id uuid primary key, avatar_url text);
create table progress_bodyweight (user_id uuid, weight_value numeric, weight_unit text, logged_date date, created_at timestamptz default now());
create table progress_metrics (client_id uuid, bodyweight numeric, bodyweight_unit text, entry_date date, created_at timestamptz default now());
create table exercises (id uuid primary key default gen_random_uuid(), name text, is_competition_lift boolean default false, competition_lift_type text);
create table pl_exercise_rows (id uuid primary key default gen_random_uuid(), exercise_id uuid);
create table pl_row_results (id uuid primary key default gen_random_uuid(), client_id uuid, row_id uuid,
  normalized_kg numeric, actual_load_kg numeric, actual_load numeric, actual_load_unit text,
  entered_value numeric, entered_unit text, actual_reps int, is_working_set boolean, load_type text,
  is_bodyweight boolean, completed_at timestamptz);
create table powerlifting_athletes (id uuid primary key default gen_random_uuid(), client_id uuid, sex text, created_at timestamptz default now(),
  athlete_name text, status text default 'active', country_filter text, openpowerlifting_url text, auto_sync boolean default false);
create table powerlifting_coaching_periods (id uuid primary key default gen_random_uuid(), athlete_id uuid, start_date date, end_date date);
create table athlete_powerlifting_results (id uuid primary key default gen_random_uuid(), athlete_id uuid, client_id uuid,
  athlete_name text not null, sex text not null, bodyweight_kg numeric not null,
  squat_kg numeric not null default 0, bench_kg numeric not null default 0, deadlift_kg numeric not null default 0,
  total_kg numeric generated always as (squat_kg + bench_kg + deadlift_kg) stored,
  gl_points numeric, meet_name text, meet_location text, meet_date date, federation text, weight_class_kg text,
  dots_points numeric, competition_level text, source text not null default 'manual', source_key text, created_at timestamptz default now());

-- Stand-in for pg_net: http_get queues the URL; tests write the responses.
create schema net;
create table net.http_request_queue (id bigserial primary key, url text);
create table net._http_response (id bigint primary key, status_code int, content text, error_msg text, timed_out boolean, created timestamptz default now());
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.http_request_queue (url) values (url) returning id $$;

-- Real scoring function, copied from 20261004100000_powerlifting_points_autocalc.sql.
CREATE OR REPLACE FUNCTION public.dots_points(_sex text, _bw numeric, _total numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _bw IS NULL OR _bw <= 0 OR _total IS NULL OR _total <= 0 THEN NULL
    WHEN lower(_sex) LIKE 'f%' THEN round(_total * 500 / (-57.96288 + 13.6175032 * _bw - 0.1126655495 * _bw^2 + 0.0005158568 * _bw^3 - 0.0000010706 * _bw^4), 2)
    ELSE round(_total * 500 / (-307.75076 + 24.0900756 * _bw - 0.1918759221 * _bw^2 + 0.0007391293 * _bw^3 - 0.000001093 * _bw^4), 2) END
$$;

-- Library: the three competition lifts plus variations (some count, some don't).
insert into exercises (name, is_competition_lift, competition_lift_type) values
  ('Competition Squat', true, 'squat'), ('Competition Bench', true, 'bench'),
  ('Competition Deadlift', true, 'deadlift'), ('High Bar Squat', false, null),
  ('Hack Squat', false, null), ('Romanian Deadlift', false, null), ('TNG Bench Press', false, null),
  ('Conventional Deadlift', false, null);
insert into pl_exercise_rows (exercise_id) select id from exercises;

-- Helpers.
create function wpg(_ts text) returns timestamptz language sql immutable as $$ select (_ts::timestamp at time zone 'America/Winnipeg') $$;
create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
create function t_client(_name text, _sex text default null) returns uuid language plpgsql as $$
declare cid uuid;
begin
  insert into clients (first_name, last_name, sex) values (split_part(_name, ' ', 1), split_part(_name, ' ', 2), _sex) returning id into cid;
  return cid;
end $$;
create function t_uid(_client uuid) returns uuid language sql as $$ select user_id from clients where id = _client $$;
create function t_bw(_client uuid, _lb numeric, _day date) returns void language sql as $$
  insert into progress_bodyweight (user_id, weight_value, weight_unit, logged_date) select user_id, _lb, 'lb', _day from clients where id = _client $$;
-- Log a set. _unit is what the athlete typed; normalized_kg is stored like the app does.
create function t_set(_client uuid, _exercise text, _load numeric, _unit text, _reps int, _at timestamptz, _sets int default 1) returns void language plpgsql as $$
begin
  for i in 1.._sets loop
    insert into pl_row_results (client_id, row_id, normalized_kg, actual_load, actual_load_unit, entered_value, entered_unit,
      actual_reps, load_type, completed_at)
    select _client, er.id, case when _unit = 'kg' then _load else round(_load * 0.45359237, 4) end, _load, _unit, _load, _unit,
      _reps, 'external', _at + make_interval(mins => i)
    from pl_exercise_rows er join exercises e on e.id = er.exercise_id where e.name = _exercise;
  end loop;
end $$;
