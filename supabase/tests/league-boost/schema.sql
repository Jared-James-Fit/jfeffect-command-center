create schema auth;
create table auth_ctx (uid uuid);
insert into auth_ctx values (null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
create type app_role as enum ('admin','client','coach','media_manager');
create table user_roles (user_id uuid, role app_role);
create function has_role(_user_id uuid, _role app_role) returns boolean language sql stable as $$ select exists(select 1 from user_roles where user_id=_user_id and role=_role) $$;
create table clients (id uuid primary key default gen_random_uuid(), user_id uuid default gen_random_uuid(), first_name text, last_name text, full_name text, archived boolean default false, archived_at timestamptz, status text default 'Active', created_at timestamptz default '2026-06-01', timezone text default 'America/Winnipeg');
create table profiles (id uuid primary key, avatar_url text);
create table progress_bodyweight (user_id uuid, weight_value numeric, weight_unit text, logged_date date, created_at timestamptz default now());
create table progress_metrics (client_id uuid, bodyweight numeric, bodyweight_unit text, entry_date date, created_at timestamptz default now());
create table pl_exercise_rows (id uuid primary key, exercise_id uuid);
create table pl_row_results (client_id uuid, row_id uuid, normalized_kg numeric, actual_load_kg numeric, actual_load numeric, actual_load_unit text, entered_value numeric, entered_unit text, actual_reps int, is_working_set boolean, load_type text, completed_at timestamptz);
create table athlete_xp_events (id uuid primary key default gen_random_uuid(), client_id uuid, event_type text, xp int, source_id uuid, occurred_at timestamptz);
create table pl_blocks (id uuid primary key default gen_random_uuid(), client_id uuid, archived boolean default false, client_visible boolean default true, status text default 'Active');
create table pl_weeks (id uuid primary key default gen_random_uuid(), block_id uuid, archived boolean default false, deleted_at timestamptz);
create table pl_days (id uuid primary key default gen_random_uuid(), week_id uuid, scheduled_date date, is_custom boolean default false, archived boolean default false, deleted_at timestamptz, title text);
create table pl_scheduled_workouts (id uuid primary key default gen_random_uuid(), source_day_id uuid, scheduled_date date, updated_at timestamptz default now());
create table pl_day_completions (id uuid primary key default gen_random_uuid(), day_id uuid, client_id uuid, completed_at timestamptz, logging_quality text);

-- Test helpers
create function t_client(_name text, _joined timestamptz default '2026-06-01', _bw boolean default true) returns uuid language plpgsql as $$
declare cid uuid; uid uuid; bid uuid;
begin
  insert into clients(first_name, last_name, created_at) values (_name, 'X', _joined) returning id, user_id into cid, uid;
  insert into pl_blocks(client_id) values (cid) returning id into bid;
  insert into pl_weeks(block_id) values (bid);
  if _bw then insert into progress_bodyweight values (uid, 180, 'lb', '2026-09-01'); end if;
  return cid;
end $$;
create function t_session(_client uuid, _date date, _custom boolean default false) returns uuid language plpgsql as $$
declare did uuid;
begin
  insert into pl_days(week_id, scheduled_date, is_custom, title)
  select w.id, _date, _custom, 'S '||_date from pl_weeks w join pl_blocks b on b.id=w.block_id where b.client_id=_client limit 1
  returning id into did;
  return did;
end $$;
create function t_complete(_client uuid, _day uuid, _at timestamptz, _full boolean default false) returns void language plpgsql as $$
declare comp uuid;
begin
  insert into pl_day_completions(day_id, client_id, completed_at) values (_day, _client, _at) returning id into comp;
  insert into athlete_xp_events(client_id, event_type, xp, source_id, occurred_at) values (_client, 'workout_completed', 100, comp, _at);
  if _full then insert into athlete_xp_events(client_id, event_type, xp, source_id, occurred_at) values (_client, 'workout_fully_logged', 20, comp, _at); end if;
end $$;
-- Local Winnipeg time helper
create function wpg(_ts text) returns timestamptz language sql immutable as $$ select (_ts::timestamp at time zone 'America/Winnipeg') $$;
create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok,false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
