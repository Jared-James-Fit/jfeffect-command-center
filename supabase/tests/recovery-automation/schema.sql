-- Minimal stand-ins for what 20270509100000_cleo_capabilities_recovery_automation.sql
-- reads, and a team: the owner (admin + business owner + coach record), Ana
-- (an active coach), Ben (a suspended coach), Fionna (a second admin, not the
-- owner), the finance login and a JF member.
\set ON_ERROR_STOP 1

create schema if not exists auth;
create table auth_ctx (uid uuid, role text, mfa_ok boolean default true);
insert into auth_ctx values (null, null, true);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
create function t_as(_uid uuid) returns void language sql as $$ update public.auth_ctx set uid = _uid, role = 'authenticated', mfa_ok = true $$;
create function t_as_service() returns void language sql as $$ update public.auth_ctx set uid = null, role = 'service_role', mfa_ok = true $$;
create function t_mfa(_ok boolean) returns void language sql as $$ update public.auth_ctx set mfa_ok = _ok $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
alter role service_role bypassrls; -- as in Supabase
grant usage on schema public, auth to authenticated, anon, service_role;
grant select on auth_ctx to authenticated, anon, service_role;

create table auth.users (id uuid primary key, email text);
create type app_role as enum ('admin', 'client', 'coach', 'finance');
create table user_roles (user_id uuid references auth.users(id) on delete cascade, role app_role, unique (user_id, role));
create function has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
-- the caller's two-step sign-in (production: aal2 for a login with a factor)
create function caller_mfa_ok(_uid uuid) returns boolean language sql stable security definer as $$
  select _uid is distinct from auth.uid() or (select mfa_ok from public.auth_ctx limit 1) $$;

create table business_owners (user_id uuid primary key references auth.users(id) on delete cascade);
create table profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text);
create table coaches (
  id uuid primary key default gen_random_uuid(), user_id uuid unique, full_name text,
  status text not null default 'Active', archived boolean not null default false);
create table clients (
  id uuid primary key default gen_random_uuid(), user_id uuid, full_name text,
  service_tier text not null default 'coaching', archived boolean not null default false,
  assigned_coach_id uuid references coaches(id), timezone text);
create table messages (
  id uuid primary key default gen_random_uuid(), client_id uuid, sender_id uuid, sender_role text, body text,
  attachments jsonb default '[]', is_internal_note boolean default false, is_automated boolean default false,
  deleted_at timestamptz, scheduled_at timestamptz, created_at timestamptz not null default now());
create table nf_submissions (
  id uuid primary key default gen_random_uuid(), client_id uuid, status text, submitted_at timestamptz,
  reviewed_at timestamptz, reviewed_by uuid);
create table pl_workout_feedback (
  id uuid primary key default gen_random_uuid(), client_id uuid, client_note text, overall_rating int not null default 4,
  pain boolean not null default false, created_at timestamptz not null default now(), review_updated_by uuid);
create table messenger_checkins (
  id uuid primary key default gen_random_uuid(), client_id uuid not null, task_type text not null default 'weekly_checkin',
  status text not null default 'pending', ai_status text, submitted_at timestamptz, reviewed_at timestamptz, superseded_at timestamptz,
  reviewed_by uuid, reviewed_via text);
create table pain_reports (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references clients(id),
  feedback_id uuid, checkin_id uuid, source text not null, region text not null, side text, site text, score smallint,
  reported_at timestamptz not null default now(), created_by uuid);

-- for 20270511090000 (videos, progress, My Voice)
create table pl_set_videos (
  id uuid primary key default gen_random_uuid(), client_id uuid not null, message_id uuid, deleted_at timestamptz,
  created_at timestamptz not null default now());
create table progress_submissions (
  id uuid primary key default gen_random_uuid(), client_id uuid, user_id uuid not null, owner_type text not null default 'client',
  review_status text not null default 'draft', submitted_at timestamptz, reviewed_at timestamptz);
create table coach_voice (id boolean primary key default true check (id), profile jsonb not null default '{}');
alter table coach_voice enable row level security;
create policy "Staff read coach voice" on coach_voice for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'coach'::app_role));
insert into coach_voice values (true, '{"rules":"the owner''s private voice"}');
create function is_business_owner(_uid uuid default auth.uid()) returns boolean language sql stable security definer as $$
  select case when exists (select 1 from business_owners where user_id = _uid) then caller_mfa_ok(_uid) else false end $$;
create function instant_to_local(_at timestamptz, _tz text) returns timestamp language sql immutable as $$ select _at at time zone _tz $$;

-- Who wrote it, as production records it: the client's own login when they save it
-- (pain_reports.created_by = auth.uid(); the review's review_updated_by), nobody / the
-- coach when a coach saves it in View as client (set t.coach_pov = on to act as one).
create function t_written_by_client() returns trigger language plpgsql as $$
begin
  if current_setting('t.coach_pov', true) = 'on' then
    if tg_table_name = 'pl_workout_feedback' then new.review_updated_by := '00000000-0000-0000-0000-0000000000a1'; end if;
    return new;
  end if;
  if tg_table_name = 'pain_reports' then
    if new.created_by is null then new.created_by := (select user_id from clients where id = new.client_id); end if;
  else
    if new.review_updated_by is null then new.review_updated_by := (select user_id from clients where id = new.client_id); end if;
  end if;
  return new;
end $$;
create trigger t_written_by_client before insert on pain_reports for each row execute function t_written_by_client();
create trigger t_written_by_client before insert on pl_workout_feedback for each row execute function t_written_by_client();

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
grant execute on function t_assert(boolean, text) to authenticated, service_role;
grant execute on function t_as(uuid), t_as_service(), t_mfa(boolean) to authenticated, service_role;
grant update on auth_ctx to authenticated, service_role;

insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'fionna@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'ana@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'ben@example.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'finance@example.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'member@example.test');
insert into business_owners values ('00000000-0000-0000-0000-0000000000a1');
insert into user_roles values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach'),
  ('00000000-0000-0000-0000-0000000000c2', 'coach'),
  ('00000000-0000-0000-0000-0000000000f1', 'finance'),
  ('00000000-0000-0000-0000-0000000000e1', 'client');
insert into coaches (id, user_id, full_name, status) values
  ('00000000-0000-0000-0000-00000000c0a0', '00000000-0000-0000-0000-0000000000a1', 'Jared Owner', 'Active'),
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 'Ana Coach', 'Active'),
  ('00000000-0000-0000-0000-00000000c0b2', '00000000-0000-0000-0000-0000000000c2', 'Ben Coach', 'Suspended');
insert into clients (id, user_id, full_name, assigned_coach_id, service_tier, archived) values
  ('00000000-0000-0000-0000-0000000c1e01', '00000000-0000-0000-0000-00000000d001', 'Marc (owner)', '00000000-0000-0000-0000-00000000c0a0', 'coaching', false),
  ('00000000-0000-0000-0000-0000000c1e02', '00000000-0000-0000-0000-00000000d002', 'Nico (Ana)', '00000000-0000-0000-0000-00000000c0a1', 'coaching', false),
  ('00000000-0000-0000-0000-0000000c1e03', '00000000-0000-0000-0000-0000000000e1', 'Mia (member)', null, 'self_serve', false),
  ('00000000-0000-0000-0000-0000000c1e04', '00000000-0000-0000-0000-00000000d004', 'Old (owner, archived)', '00000000-0000-0000-0000-00000000c0a0', 'coaching', true),
  ('00000000-0000-0000-0000-0000000c1e05', '00000000-0000-0000-0000-00000000d005', 'Devin (owner)', '00000000-0000-0000-0000-00000000c0a0', 'coaching', false);
grant select on all tables in schema public to authenticated, service_role;
grant insert, update, delete on all tables in schema public to service_role;

-- pg_cron and pg_net aren't here: the migration's schedule block steps aside.
