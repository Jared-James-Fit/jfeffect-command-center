-- Stand-ins for what 20270507090000_organizations_foundation.sql,
-- 20270509090000_coach_platform_early_access.sql and
-- 20270510090000_coach_workspaces.sql use, with JF Effect's policies on the
-- client tables written the way production has them (the admin reads all, a
-- coach their own clients through coached_client_ids(), a client their own
-- rows) plus one deliberately loose policy (community_posts: any signed-in
-- person), so the fence is tested against the worst case, not only tidy rules.
\set ON_ERROR_STOP 1

create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth_ctx (uid uuid, role text);
insert into auth_ctx values (null, null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
create function auth.role() returns text language sql stable as $$ select role from public.auth_ctx limit 1 $$;
create function t_as(_uid uuid) returns void language sql as $$ update public.auth_ctx set uid = _uid, role = 'authenticated' $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
alter role service_role bypassrls;
grant usage on schema public, auth to authenticated, anon, service_role;
grant select, update on auth_ctx to authenticated, anon, service_role;

create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz default now());
grant select on auth.users to service_role;

create type app_role as enum ('admin', 'client', 'coach', 'finance');
create table user_roles (user_id uuid references auth.users(id) on delete cascade, role app_role, is_primary boolean default false, unique (user_id, role));
create function caller_mfa_ok(_uid uuid) returns boolean language sql stable as $$ select true $$;
create function has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create function is_admin_viewer() returns boolean language sql stable as $$ select false $$;

create table business_owners (user_id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now());
create table profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text, email text);
create table app_settings (key text primary key, value text, updated_at timestamptz default now());
grant all on app_settings to service_role;

create table coaches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  full_name text, email text,
  status text not null default 'Pending Invite',
  archived boolean not null default false
);
create table clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  full_name text,
  email text,
  service_tier text not null default 'coaching',
  status text not null default 'Active',
  archived boolean not null default false,
  assigned_coach_id uuid references coaches(id),
  created_at timestamptz not null default now(),
  constraint clients_service_tier_check check (service_tier in ('coaching', 'self_serve'))
);
create function coached_client_ids() returns setof uuid language sql stable security definer as $$
  select c.id from clients c join coaches co on co.id = c.assigned_coach_id
   where co.user_id = auth.uid() and co.archived = false and co.status = 'Active' $$;
create function coached_client_user_ids() returns setof uuid language sql stable security definer as $$
  select c.user_id from clients c join coaches co on co.id = c.assigned_coach_id
   where co.user_id = auth.uid() and co.archived = false and co.status = 'Active' and c.user_id is not null $$;
-- the staff login linked to its own athlete record (none in these tests)
create function linked_client_id() returns uuid language sql stable security definer as $$ select null::uuid $$;
create table purchase_records (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id),
  term_start_date date, term_end_date date, package_expiry_date date, term_date_history jsonb, term_auto_calculated boolean,
  term_length_snapshot int, term_unit_snapshot text, updated_at timestamptz default now());

-- the client-keyed tables, JF Effect's rules on each
create table pl_blocks (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id), name text);
create table pl_weeks (id uuid primary key default gen_random_uuid(), block_id uuid references pl_blocks(id) on delete cascade, week_index int);
create table pl_days (id uuid primary key default gen_random_uuid(), week_id uuid references pl_weeks(id) on delete cascade, title text);
create table pl_exercise_rows (id uuid primary key default gen_random_uuid(), day_id uuid references pl_days(id) on delete cascade, sets int);
create table pl_row_results (id uuid primary key default gen_random_uuid(), client_id uuid, row_id uuid, actual_load numeric);
create table progress_bodyweight (id uuid primary key default gen_random_uuid(), user_id uuid, weight_value numeric);
create table nutrition_targets (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id), calories int);
create table nutrition_target_days (id uuid primary key default gen_random_uuid(), target_id uuid references nutrition_targets(id), notes text);
create table nf_submissions (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id));
create table nf_answers (id uuid primary key default gen_random_uuid(), submission_id uuid references nf_submissions(id), value_text text);
create table messages (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id), body text);
create table community_posts (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id), caption text);
create table payment_ledger (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id), amount_cents int);
-- a staff-only backup table with RLS on and no policies at all
create table accessory_flow_backup (id uuid primary key default gen_random_uuid(), client_id uuid);

do $$
declare t text;
begin
  foreach t in array array['clients','pl_blocks','pl_weeks','pl_days','pl_exercise_rows','pl_row_results','progress_bodyweight',
    'nutrition_targets','nutrition_target_days','nf_submissions','nf_answers','messages','community_posts','payment_ledger',
    'accessory_flow_backup','purchase_records'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

-- admin: everything (the bare has_role the fence must hold back)
do $$
declare t text;
begin
  foreach t in array array['clients','pl_blocks','pl_weeks','pl_days','pl_exercise_rows','pl_row_results','progress_bodyweight',
    'nutrition_targets','nutrition_target_days','nf_submissions','nf_answers','messages','community_posts','payment_ledger','purchase_records'] loop
    execute format('create policy "admin all" on %I for all to authenticated using (has_role(auth.uid(), ''admin'')) with check (has_role(auth.uid(), ''admin''))', t);
  end loop;
end $$;

-- coach: their own clients
create policy "coach clients" on clients for select to authenticated using (id in (select coached_client_ids()));
create policy "coach blocks" on pl_blocks for all to authenticated using (client_id in (select coached_client_ids())) with check (client_id in (select coached_client_ids()));
create policy "coach weeks" on pl_weeks for all to authenticated using (block_id in (select id from pl_blocks where client_id in (select coached_client_ids())));
create policy "coach days" on pl_days for all to authenticated using (week_id in (select w.id from pl_weeks w join pl_blocks b on b.id = w.block_id where b.client_id in (select coached_client_ids())));
create policy "coach rows" on pl_exercise_rows for all to authenticated using (day_id in (select d.id from pl_days d join pl_weeks w on w.id = d.week_id join pl_blocks b on b.id = w.block_id where b.client_id in (select coached_client_ids())));
create policy "coach results" on pl_row_results for select to authenticated using (client_id in (select coached_client_ids()));
create policy "coach bodyweight" on progress_bodyweight for select to authenticated using (user_id in (select coached_client_user_ids()));
create policy "coach messages" on messages for all to authenticated using (client_id in (select coached_client_ids())) with check (client_id in (select coached_client_ids()));

-- a client: their own rows
create policy "own client" on clients for select to authenticated using (user_id = auth.uid());
create policy "own blocks" on pl_blocks for select to authenticated using (client_id in (select id from clients where user_id = auth.uid()));
create policy "own weeks" on pl_weeks for select to authenticated using (block_id in (select b.id from pl_blocks b join clients c on c.id = b.client_id where c.user_id = auth.uid()));
create policy "own days" on pl_days for select to authenticated using (week_id in (select w.id from pl_weeks w join pl_blocks b on b.id = w.block_id join clients c on c.id = b.client_id where c.user_id = auth.uid()));
create policy "own results" on pl_row_results for all to authenticated using (client_id in (select id from clients where user_id = auth.uid())) with check (client_id in (select id from clients where user_id = auth.uid()));
create policy "own bodyweight" on progress_bodyweight for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own targets" on nutrition_targets for select to authenticated using (client_id in (select id from clients where user_id = auth.uid()));
create policy "own messages" on messages for all to authenticated using (client_id in (select id from clients where user_id = auth.uid())) with check (client_id in (select id from clients where user_id = auth.uid()));
create policy "own submissions" on nf_submissions for all to authenticated using (client_id in (select id from clients where user_id = auth.uid())) with check (client_id in (select id from clients where user_id = auth.uid()));
create policy "own answers" on nf_answers for all to authenticated using (submission_id in (select s.id from nf_submissions s join clients c on c.id = s.client_id where c.user_id = auth.uid()));
-- the loose one: anyone signed in reads every crew post
create policy "crew reads posts" on community_posts for select to authenticated using (auth.uid() is not null);

create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
grant execute on function t_assert(boolean, text) to authenticated, anon;
grant execute on function t_as(uuid) to authenticated, anon;
-- a token's hash, the way the server makes it
create function t_hash(_t text) returns text language sql immutable as $$ select encode(sha256(convert_to(_t, 'UTF8')), 'hex') $$;
grant execute on function t_hash(text) to authenticated, anon;

-- ── people ────────────────────────────────────────────────────────────────
-- JF Effect: Jared (owner, admin), Ana (coach of Marc), Mia (a free member).
-- Olivia: a JF member who runs her own business (A) with Cole on her team.
-- Bo runs business B. Priya, Quinn (A) and Bea (B) will be their clients;
-- Sam has a login and nothing else.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'jared@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'ana@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'marc@example.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'mia@example.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'olivia@example.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'cole@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'bo@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'priya@example.test'),
  ('00000000-0000-0000-0000-0000000000a6', 'quinn@example.test'),
  ('00000000-0000-0000-0000-0000000000b5', 'bea@example.test'),
  ('00000000-0000-0000-0000-0000000000e9', 'sam@example.test');
-- Quinn hasn't confirmed her email yet
update auth.users set email_confirmed_at = null where id = '00000000-0000-0000-0000-0000000000a6';
insert into profiles (id, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Jared Owner'), ('00000000-0000-0000-0000-0000000000c1', 'Ana Coach'),
  ('00000000-0000-0000-0000-0000000000f1', 'Olivia Strong'), ('00000000-0000-0000-0000-0000000000a5', 'Priya Lifts');
insert into business_owners (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach'),
  ('00000000-0000-0000-0000-0000000000d1', 'client'),
  ('00000000-0000-0000-0000-0000000000e1', 'client'),
  ('00000000-0000-0000-0000-0000000000f1', 'client'),
  -- every new sign-up gets the client role, a coach's clients included
  ('00000000-0000-0000-0000-0000000000a5', 'client'),
  ('00000000-0000-0000-0000-0000000000b5', 'client');
insert into coaches (id, user_id, full_name, email, status) values
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1', 'Ana Coach', 'ana@example.test', 'Active');
insert into clients (id, user_id, full_name, email, service_tier, status, assigned_coach_id) values
  ('00000000-0000-0000-0000-0000000c1e01', '00000000-0000-0000-0000-0000000000d1', 'Marc Client', 'marc@example.test', 'coaching', 'Active', '00000000-0000-0000-0000-00000000c0a1'),
  ('00000000-0000-0000-0000-0000000c1e03', '00000000-0000-0000-0000-0000000000e1', 'Mia Member', 'mia@example.test', 'self_serve', 'Member', null),
  ('00000000-0000-0000-0000-0000000c1e04', '00000000-0000-0000-0000-0000000000f1', 'Olivia Strong', 'olivia@example.test', 'self_serve', 'Member', null);

-- JF Effect's records for its people
insert into pl_blocks (id, client_id, name) values
  ('00000000-0000-0000-0000-00000000b0c1', '00000000-0000-0000-0000-0000000c1e01', 'Marc block'),
  ('00000000-0000-0000-0000-00000000b0c3', '00000000-0000-0000-0000-0000000c1e03', 'Mia plan');
insert into pl_weeks (id, block_id, week_index) values
  ('00000000-0000-0000-0000-00000000d0c1', '00000000-0000-0000-0000-00000000b0c1', 1),
  ('00000000-0000-0000-0000-00000000d0c3', '00000000-0000-0000-0000-00000000b0c3', 1);
insert into pl_days (id, week_id, title) values
  ('00000000-0000-0000-0000-00000000e0c1', '00000000-0000-0000-0000-00000000d0c1', 'Marc day'),
  ('00000000-0000-0000-0000-00000000e0c3', '00000000-0000-0000-0000-00000000d0c3', 'Mia day');
insert into pl_exercise_rows (day_id, sets) values
  ('00000000-0000-0000-0000-00000000e0c1', 3), ('00000000-0000-0000-0000-00000000e0c3', 4);
insert into pl_row_results (client_id, actual_load) values
  ('00000000-0000-0000-0000-0000000c1e01', 100), ('00000000-0000-0000-0000-0000000c1e03', 60);
insert into progress_bodyweight (user_id, weight_value) values
  ('00000000-0000-0000-0000-0000000000d1', 80), ('00000000-0000-0000-0000-0000000000e1', 62);
insert into nutrition_targets (id, client_id, calories) values ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000c1e01', 2600);
insert into nutrition_target_days (target_id, notes) values ('00000000-0000-0000-0000-00000000aa01', 'Marc meals');
insert into nf_submissions (id, client_id) values ('00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-0000000c1e01');
insert into nf_answers (submission_id, value_text) values ('00000000-0000-0000-0000-00000000ab01', 'Marc answer');
insert into messages (client_id, body) values ('00000000-0000-0000-0000-0000000c1e01', 'Marc to Ana');
insert into community_posts (client_id, caption) values
  ('00000000-0000-0000-0000-0000000c1e01', 'Marc PR'), ('00000000-0000-0000-0000-0000000c1e03', 'Mia PR');
insert into payment_ledger (client_id, amount_cents) values ('00000000-0000-0000-0000-0000000c1e01', 67200);

-- What each JF Effect person sees before any of it runs: the regression baseline.
create table t_seen (who text, tbl text, n int, phase text);
grant all on t_seen to authenticated;
create function t_count_all(_who text, _phase text) returns void language plpgsql as $$
declare t text; n int;
begin
  foreach t in array array['clients','pl_blocks','pl_weeks','pl_days','pl_exercise_rows','pl_row_results','progress_bodyweight',
    'nutrition_targets','nutrition_target_days','nf_submissions','nf_answers','messages','community_posts','payment_ledger'] loop
    execute format('select count(*) from %I', t) into n;
    insert into t_seen values (_who, t, n, _phase);
  end loop;
end $$;
grant execute on function t_count_all(text, text) to authenticated;
