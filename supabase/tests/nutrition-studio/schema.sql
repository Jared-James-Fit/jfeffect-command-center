-- Stand-ins for what 20270508090000_nutrition_studio.sql uses: a member, a
-- coaching client, their coach, and the coach's plan for the client.
\set ON_ERROR_STOP 1
create schema if not exists auth;
create table auth_ctx (uid uuid);
insert into auth_ctx values (null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
create function t_as(_uid uuid) returns void language sql as $$ update public.auth_ctx set uid = _uid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
grant usage on schema public, auth to authenticated, anon, service_role;
grant select, update on auth_ctx to authenticated;
create table auth.users (id uuid primary key);
create type app_role as enum ('admin', 'client', 'coach', 'finance');
create table user_roles (user_id uuid, role app_role);
create function has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create function tg_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create table organizations (id uuid primary key);
create table coaches (id uuid primary key, user_id uuid);
create table clients (id uuid primary key, user_id uuid, service_tier text, archived boolean default false, assigned_coach_id uuid);
create function coached_client_ids() returns setof uuid language sql stable security definer as $$
  select c.id from clients c join coaches co on co.id = c.assigned_coach_id where co.user_id = auth.uid() $$;
create table nutrition_targets (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id), status text default 'Active',
  phase text, assigned_coach_id uuid, visible_to_client boolean default false, admin_notes text, updated_at timestamptz);
create table nutrition_target_days (id uuid primary key default gen_random_uuid(), target_id uuid references nutrition_targets(id) on delete cascade, day_label text, notes text, calories int);
alter table nutrition_targets enable row level security;
alter table nutrition_target_days enable row level security;
grant select, insert, update, delete on nutrition_targets, nutrition_target_days to authenticated;
grant select on clients, coaches to authenticated;
-- the existing policies (production, Nov 22 2026)
create policy "Coach manage assigned nutrition_targets" on nutrition_targets for all to authenticated using (client_id in (select coached_client_ids())) with check (client_id in (select coached_client_ids()));
create policy "Client read own nutrition_targets" on nutrition_targets for select to authenticated using (visible_to_client and exists (select 1 from clients c where c.id = nutrition_targets.client_id and c.user_id = (select auth.uid())));
create policy "Coach manage assigned nutrition_target_days" on nutrition_target_days for all to authenticated using (exists (select 1 from nutrition_targets nt where nt.id = nutrition_target_days.target_id and nt.client_id in (select coached_client_ids())));
create policy "Client read own nutrition_target_days" on nutrition_target_days for select to authenticated using (exists (select 1 from nutrition_targets nt join clients c on c.id = nt.client_id where nt.id = nutrition_target_days.target_id and nt.visible_to_client and c.user_id = (select auth.uid())));
create function t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
grant execute on function t_assert(boolean, text), t_as(uuid) to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2'), ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000d1');
insert into user_roles values ('00000000-0000-0000-0000-0000000000c1', 'coach'), ('00000000-0000-0000-0000-0000000000a1', 'admin');
insert into coaches values ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000c1');
insert into clients values
  ('00000000-0000-0000-0000-0000000c1e01', '00000000-0000-0000-0000-0000000000e1', 'self_serve', false, null),   -- Mia, a member
  ('00000000-0000-0000-0000-0000000c1e02', '00000000-0000-0000-0000-0000000000e2', 'coaching', false, '00000000-0000-0000-0000-00000000c0a1'), -- Marc, coached
  ('00000000-0000-0000-0000-0000000c1e03', '00000000-0000-0000-0000-0000000000d1', 'self_serve', false, null);   -- Dee, another member
insert into nutrition_targets (id, client_id, assigned_coach_id, visible_to_client) values
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-0000000c1e02', '00000000-0000-0000-0000-00000000c0a1', true),
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-0000000c1e03', null, true);
