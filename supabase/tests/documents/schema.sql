-- Minimal stand-ins for what 20270507095000_documents_library.sql uses:
-- auth.uid() / auth.role(), roles, auth.users, user_roles + has_role, clients,
-- coaches + coached_client_ids(), storage.buckets / storage.objects (RLS on,
-- metadata as Supabase's storage writes it) and the real rls_evaluate_once.
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
  service_tier text not null default 'coaching',
  assigned_coach_id uuid references coaches(id)
);
create function coached_client_ids() returns setof uuid language sql stable security definer as $$
  select c.id from clients c join coaches co on co.id = c.assigned_coach_id
   where co.user_id = auth.uid() and co.archived = false and co.status = 'Active' $$;

-- Storage as Supabase lays it out (the columns the migration reads).
create schema if not exists storage;
grant usage on schema storage to authenticated, anon, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to authenticated;

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;

-- The people: the owner (admin), two active coaches, a coaching client of
-- each, a free member (no coach) and a stranger with a login and nothing else.
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'ana@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'ben@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'marc@example.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'nico@example.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'mia@example.test'),
  ('00000000-0000-0000-0000-0000000000f9', 'stranger@example.test');
insert into user_roles values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach'),
  ('00000000-0000-0000-0000-0000000000c2', 'coach'),
  ('00000000-0000-0000-0000-0000000000d1', 'client'),
  ('00000000-0000-0000-0000-0000000000d2', 'client'),
  ('00000000-0000-0000-0000-0000000000e1', 'client');
insert into coaches (id, user_id, full_name) values
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 'Ana Coach'),
  ('00000000-0000-0000-0000-00000000c0b2', '00000000-0000-0000-0000-0000000000c2', 'Ben Coach');
insert into clients (id, user_id, full_name, service_tier, assigned_coach_id) values
  ('00000000-0000-0000-0000-0000000c1e01', '00000000-0000-0000-0000-0000000000d1', 'Marc Client', 'coaching', '00000000-0000-0000-0000-00000000c0a1'),
  ('00000000-0000-0000-0000-0000000c1e02', '00000000-0000-0000-0000-0000000000d2', 'Nico Client', 'coaching', '00000000-0000-0000-0000-00000000c0b2'),
  ('00000000-0000-0000-0000-0000000c1e03', '00000000-0000-0000-0000-0000000000e1', 'Mia Member', 'self_serve', null);

-- The real rls_evaluate_once (20261115090000_rls_evaluate_once.sql), so the
-- migration's last line runs as it does in production.
CREATE OR REPLACE FUNCTION public.rls_once_expr(e text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF e IS NULL THEN
    RETURN NULL;
  END IF;
  e := regexp_replace(e,
    '(?<![._[:alnum:]])(?<!SELECT )(has_role|has_permission|is_coach_or_admin|is_admin_or_media_manager|is_media_manager|is_business_owner|is_active_coach)\(auth\.uid\(\)((, ''[^'']*''::[a-z_]+)?)\)',
    '(SELECT \1((SELECT auth.uid())\2))', 'g');
  e := regexp_replace(e,
    '(?<![._[:alnum:]])(?<!SELECT )(current_member_id|current_coach_id|linked_client_id|is_admin_viewer|is_exercise_library_staff|is_community_staff)\(\)',
    '(SELECT \1())', 'g');
  e := regexp_replace(e,
    '(?<![._[:alnum:]])is_assigned_coach_for_member\(([a-z_]+(\.[a-z_]+)?)\)',
    '(\1 IN (SELECT coached_member_ids()))', 'g');
  e := regexp_replace(e,
    '(?<![._[:alnum:]])is_assigned_coach(_for_client)?\(([a-z_]+(\.[a-z_]+)?)\)',
    '(\2 IN (SELECT coached_client_ids()))', 'g');
  e := regexp_replace(e, '(?<!SELECT )auth\.(uid|role)\(\)', '(SELECT auth.\1())', 'g');
  RETURN e;
END;
$$;
CREATE OR REPLACE FUNCTION public.rls_evaluate_once(_table text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r record;
  nq text;
  nw text;
  stmt text;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (_table IS NULL OR tablename = _table)
  LOOP
    nq := public.rls_once_expr(r.qual);
    nw := public.rls_once_expr(r.with_check);
    CONTINUE WHEN nq IS NOT DISTINCT FROM r.qual AND nw IS NOT DISTINCT FROM r.with_check;
    stmt := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF nq IS DISTINCT FROM r.qual THEN
      stmt := stmt || format(' USING (%s)', nq);
    END IF;
    IF nw IS DISTINCT FROM r.with_check THEN
      stmt := stmt || format(' WITH CHECK (%s)', nw);
    END IF;
    EXECUTE stmt;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

grant execute on all functions in schema public to authenticated;
