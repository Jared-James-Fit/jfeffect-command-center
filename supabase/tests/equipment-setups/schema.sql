-- Minimal stand-ins for the tables and helpers 20270418090000_equipment_setups.sql uses.
create schema if not exists auth;
create table auth_ctx (uid uuid);
insert into auth_ctx values (null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
create function t_as(_uid uuid) returns void language sql as $$ update public.auth_ctx set uid = _uid $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

create type app_role as enum ('admin', 'client', 'coach');
create table user_roles (user_id uuid, role app_role);
create function has_role(_user_id uuid, _role app_role) returns boolean language sql stable as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;

create table coaches (id uuid primary key default gen_random_uuid(), user_id uuid, archived boolean default false, status text default 'Active');
create table clients (id uuid primary key default gen_random_uuid(), user_id uuid, assigned_coach_id uuid, full_name text);
create function coached_client_ids() returns setof uuid language sql stable security definer as $$
  select c.id from clients c join coaches co on co.id = c.assigned_coach_id
   where co.user_id = auth.uid() and co.archived = false and co.status = 'Active' $$;
create function linked_client_id() returns uuid language sql stable as $$ select null::uuid $$;
create function is_assigned_coach(_client_id uuid) returns boolean language sql stable security definer as $$
  select _client_id in (select coached_client_ids()) $$;
create function workout_can_act_for_client(_client_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from clients c where c.id = _client_id and c.user_id = auth.uid())
      or has_role(auth.uid(), 'admin')
      or is_assigned_coach(_client_id) $$;

create table exercises (id uuid primary key default gen_random_uuid(), name text);
create table pl_exercise_rows (id uuid primary key default gen_random_uuid(), day_id uuid, exercise_id uuid);
create table pl_row_results (
  id uuid primary key default gen_random_uuid(),
  row_id uuid, client_id uuid, set_index int, actual_load numeric, actual_reps int,
  completed_at timestamptz, scheduled_workout_id uuid, updated_at timestamptz default now()
);
create table pl_exercise_row_trash (id uuid primary key default gen_random_uuid(), row_id uuid, results jsonb);
create table exercise_dedupe_audit (id bigserial primary key, duplicate_id uuid, canonical_id uuid);

create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
