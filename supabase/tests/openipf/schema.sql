-- Minimal stand-ins for what 20270525090000_openipf_discovery.sql uses: auth,
-- roles, coaches and clients, the powerlifting tables and the sync's own
-- functions, account deletions, app settings, vault, and a pg_net whose
-- answers the scenario writes itself (fake_web).
\set ON_ERROR_STOP 1

create extension if not exists pgcrypto;
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

create table coaches (id uuid primary key default gen_random_uuid(), user_id uuid unique, full_name text, status text not null default 'Active', archived boolean not null default false);
create table clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, full_name text, first_name text, last_name text, preferred_name text, sex text,
  service_tier text not null default 'coaching', archived boolean not null default false, status text default 'Active',
  openpowerlifting_url text, assigned_coach_id uuid references coaches(id), date_of_birth date, country text);
create function coached_client_ids() returns setof uuid language sql stable security definer as $$
  select c.id from clients c join coaches co on co.id = c.assigned_coach_id
   where co.user_id = auth.uid() and co.archived = false and co.status = 'Active' $$;
grant select, update on clients to authenticated;
create table account_deletions (id uuid primary key default gen_random_uuid(), client_id uuid, status text not null default 'pending');
create table app_settings (id uuid primary key default gen_random_uuid(), key text unique, value text, created_at timestamptz default now(), updated_at timestamptz default now());

create table powerlifting_athletes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique references clients(id) on delete set null,
  athlete_name text not null, sex text not null check (sex in ('male', 'female')),
  openpowerlifting_url text, auto_sync boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  status text not null default 'active',
  opl_synced_at timestamptz, opl_sync_status text, opl_meet_count integer);
create table powerlifting_coaching_periods (id uuid primary key default gen_random_uuid(), athlete_id uuid references powerlifting_athletes(id) on delete cascade);
create table athlete_powerlifting_results (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  athlete_name text, sex text, bodyweight_kg numeric,
  squat_kg numeric default 0, bench_kg numeric default 0, deadlift_kg numeric default 0,
  total_kg numeric generated always as (coalesce(squat_kg, 0) + coalesce(bench_kg, 0) + coalesce(deadlift_kg, 0)) stored,
  points numeric, points_system text, meet_name text, meet_location text, meet_date date, competition_level text, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  athlete_id uuid references powerlifting_athletes(id) on delete cascade,
  source text, source_key text, weight_class_kg text, federation text, gl_points numeric, dots_points numeric,
  place text, division text, equipment text, event text, meet_town text, parent_federation text,
  tested boolean, sanctioned boolean, attempts jsonb);
create unique index athlete_powerlifting_source_key_idx on athlete_powerlifting_results (athlete_id, source, source_key) where source_key is not null;
grant select on athlete_powerlifting_results, powerlifting_athletes to authenticated;

-- the sync's own pieces, as production has them
create function powerlifting_opl_profile(_url text, out host text, out slug text) returns record language sql immutable as $$
  select case when _url ~* 'openipf\.org' then 'https://www.openipf.org' else 'https://www.openpowerlifting.org' end,
         lower((regexp_match(coalesce(_url, ''), '/u/([^/?#]+)', 'i'))[1]) $$;
create function opl_csv_records(_csv text) returns setof jsonb language sql immutable as $$
  with lines as (select l, n from regexp_split_to_table(coalesce(_csv, ''), E'\\r?\\n') with ordinality t(l, n) where l <> ''),
  cells as (
    select ln.n, f.i, case when f.m[1] like '"%"' then replace(substr(f.m[1], 2, length(f.m[1]) - 2), '""', '"') else f.m[1] end v
    from lines ln cross join lateral regexp_matches(ln.l, '(?:^|,)("(?:[^"]|"")*"|[^,]*)', 'g') with ordinality f(m, i)),
  header as (select array_agg(v order by i) h from cells where n = 1)
  select jsonb_object_agg(h.h[c.i], c.v) from cells c, header h where c.n > 1 and c.i <= coalesce(array_length(h.h, 1), 0) group by c.n order by c.n $$;

-- pg_net: requests are logged, answers come from fake_web when the scenario says so
create schema net;
create table net.requests (id bigserial primary key, method text, url text, created timestamptz default now());
create table net._http_response (id bigint, status_code integer, content text, error_msg text, timed_out boolean, created timestamptz default now());
create function net.http_get(url text, timeout_milliseconds integer default 5000) returns bigint language sql as $$
  insert into net.requests (method, url) values ('GET', url) returning id $$;
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint language sql as $$
  insert into net.requests (method, url) values ('POST', url) returning id $$;
create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('cron_hook_secret', 'test');

create table powerlifting_opl_sync_requests (request_id bigint primary key, athlete_id uuid, slug text);
create function powerlifting_opl_request(_athlete uuid default null) returns bigint[] language plpgsql security definer as $$
declare rid bigint; a record; ids bigint[] := '{}';
begin
  for a in select pa.id, p.host, p.slug from powerlifting_athletes pa cross join lateral powerlifting_opl_profile(pa.openpowerlifting_url) p
    where p.slug is not null and (case when _athlete is null then pa.auto_sync else pa.id = _athlete end) loop
    rid := net.http_get(a.host || '/api/liftercsv/' || a.slug);
    insert into powerlifting_opl_sync_requests values (rid, a.id, a.slug);
    ids := ids || rid;
  end loop;
  return ids;
end $$;

-- The web the scenario sees: a URL's answer, written before each step.
create table fake_web (url text primary key, status integer not null default 200, body text);
create function t_answer() returns integer language plpgsql as $$
declare r record; n integer := 0;
begin
  for r in select q.id, q.url from net.requests q
    where q.method = 'GET' and not exists (select 1 from net._http_response x where x.id = q.id) loop
    insert into net._http_response (id, status_code, content)
    select r.id, coalesce(w.status, case when r.url like '%/api/search/%' then 200 else 404 end),
      coalesce(w.body, case when r.url like '%/api/search/%' then '{"next_index":null}' else 'Not Found' end)
    from (select 1) one left join fake_web w on w.url = r.url;
    n := n + 1;
  end loop;
  return n;
end $$;
-- Runs a scan the way the tick would, answering each round, until it's done.
create function t_run(_scan uuid) returns void language plpgsql as $$
declare i integer := 0;
begin
  loop
    perform public._openipf_step(_scan);
    perform t_answer();
    i := i + 1;
    exit when (select finished_at is not null from public.openipf_scans where id = _scan) or i > 60;
  end loop;
  if i > 60 then raise exception 'scan never finished'; end if;
end $$;

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
grant execute on function t_assert(boolean, text) to authenticated, anon;
