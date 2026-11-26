-- Minimal stand-ins for what 20270602090000_virtual_account_names.sql uses: auth (users,
-- identities, uid), pgcrypto in extensions, roles, profiles, clients, coaches, the Crew tables,
-- virtual_accounts and its activity as 20270601090000 made them, the settings and the helpers the
-- like tick calls. Then the state production could be in before the migration: twelve starter
-- accounts plus three with placeholder names ("Jon Doe", "Jane Doe", "Test User") made the old
-- way, with likes, a follower and history that must survive their rename.
\set ON_ERROR_STOP 1

create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create table public.auth_ctx (uid uuid);
insert into public.auth_ctx values (null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
create function public.t_as(_uid uuid) returns void language sql as $$ update public.auth_ctx set uid = _uid $$;
grant usage on schema public, auth, extensions to authenticated, anon, service_role;
grant select, update on public.auth_ctx to authenticated, anon, service_role;

create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text unique, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text,
  email_change_token_current text, phone_change text, phone_change_token text, reauthentication_token text,
  banned_until timestamptz, is_sso_user boolean default false, is_anonymous boolean default false
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(), provider_id text, user_id uuid references auth.users(id) on delete cascade,
  identity_data jsonb, provider text, created_at timestamptz, updated_at timestamptz
);

create type public.app_role as enum ('admin', 'client', 'coach', 'finance');
create table public.user_roles (user_id uuid references auth.users(id) on delete cascade, role public.app_role, unique (user_id, role));
create function public.has_role(_user_id uuid, _role public.app_role) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;
create function public.is_admin_viewer() returns boolean language sql stable as $$ select false $$;

create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text, updated_at timestamptz);
-- handle_new_user's part that matters here: a profile named from the sign-up's metadata
create function public.t_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data->>'full_name') on conflict do nothing;
  return new;
end $$;
create trigger t_new_user after insert on auth.users for each row execute function public.t_new_user();

create table public.clients (
  id uuid primary key default gen_random_uuid(), user_id uuid, first_name text, last_name text,
  preferred_name text, full_name text
);
create table public.coaches (
  id uuid primary key default gen_random_uuid(), user_id uuid, first_name text, last_name text, full_name text
);

create table public.community_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text check (username is null or (username = lower(username) and username ~ '^[a-z0-9._]{3,24}$' and username !~ '^[._]|[._]$|\.\.')),
  username_set_at timestamptz, bio text check (bio is null or char_length(bio) <= 150),
  disciplines text[] not null default '{}', discoverable boolean default true, avatar_path text, updated_at timestamptz
);
create unique index community_profiles_username on public.community_profiles (username);
create table public.community_posts (
  id uuid primary key default gen_random_uuid(), author_user_id uuid, archived_at timestamptz, visibility text default 'community',
  story_only boolean default false, auto_shared boolean default false, series text, created_at timestamptz default now()
);
create table public.community_reactions (post_id uuid, user_id uuid, emoji text, primary key (post_id, user_id));
create table public.community_follows (follower_id uuid, followee_id uuid, primary key (follower_id, followee_id));
create function public.community_staff_people() returns setof uuid language sql stable as $$
  select r.user_id from public.user_roles r where r.role in ('admin', 'coach') $$;
create function public.chat_has_blocked(a uuid, b uuid) returns boolean language sql stable as $$ select false $$;
create function public.instant_to_local(_t timestamptz, _zone text) returns timestamp language sql stable as $$ select _t at time zone _zone $$;

create table public.app_settings (key text primary key, value text, updated_at timestamptz default now());
insert into public.app_settings (key, value)
values ('virtual_accounts', '{"automation_enabled":false,"per_post_max":2,"max_post_age_hours":36,"min_post_age_minutes":20,"include_coach_posts":false}');
create function public.virtual_accounts_settings() returns jsonb language plpgsql stable security definer as $$
declare v jsonb;
begin
  select nullif(btrim(s.value), '')::jsonb into v from public.app_settings s where s.key = 'virtual_accounts';
  return jsonb_build_object(
    'automation_enabled', coalesce((v->>'automation_enabled')::boolean, false),
    'per_post_max', least(greatest(coalesce((v->>'per_post_max')::int, 2), 1), 5),
    'max_post_age_hours', least(greatest(coalesce((v->>'max_post_age_hours')::int, 36), 6), 96),
    'min_post_age_minutes', least(greatest(coalesce((v->>'min_post_age_minutes')::int, 20), 5), 240),
    'include_coach_posts', coalesce((v->>'include_coach_posts')::boolean, false));
end $$;

-- virtual_accounts and its activity exactly as 20270601090000 made them
create table public.virtual_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9._]{3,24}$'),
  first_name text not null check (char_length(btrim(first_name)) between 1 and 40),
  last_name text check (last_name is null or char_length(last_name) <= 40),
  background text, active boolean not null default true, likes_enabled boolean not null default false,
  daily_like_limit smallint not null default 4 check (daily_like_limit between 0 and 20),
  quiet_start smallint not null default 22, quiet_end smallint not null default 7, notes text,
  created_by uuid, created_at timestamptz not null default now(), updated_by uuid, updated_at timestamptz not null default now()
);
create table public.virtual_account_activity (
  id bigserial primary key, user_id uuid not null,
  action text not null check (action in ('created', 'updated', 'activated', 'deactivated', 'likes_on', 'likes_off',
                                         'like', 'unlike', 'likes_cleared', 'settings')),
  post_id uuid, actor_user_id uuid, detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create function public.t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if; raise notice 'ok: %', _msg; end $$;
grant execute on function public.t_assert(boolean, text) to authenticated, anon;

-- People: the owner (admin) and coach Jared McIntyre, real clients, a member who signed up as
-- "John Doe" (a real person's own login: never touched), and a member login.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@jf.test', '{"full_name":"Jared McIntyre"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'marc@jf.test', '{"full_name":"Marc Asugui"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'ashley@jf.test', '{"full_name":"Ashley Santos"}'),
  ('00000000-0000-0000-0000-0000000000b3', 'johndoe@jf.test', '{"full_name":"John Doe"}'),
  ('00000000-0000-0000-0000-0000000000b4', 'devin@jf.test', '{"full_name":"Devin Buth"}');
insert into public.user_roles values ('00000000-0000-0000-0000-0000000000a1', 'admin'), ('00000000-0000-0000-0000-0000000000a1', 'coach'),
  ('00000000-0000-0000-0000-0000000000b1', 'client'), ('00000000-0000-0000-0000-0000000000b2', 'client'),
  ('00000000-0000-0000-0000-0000000000b3', 'client'), ('00000000-0000-0000-0000-0000000000b4', 'client');
insert into public.coaches (user_id, first_name, last_name, full_name) values ('00000000-0000-0000-0000-0000000000a1', 'Jared', 'McIntyre', 'Jared McIntyre');
insert into public.clients (user_id, first_name, last_name, preferred_name, full_name) values
  ('00000000-0000-0000-0000-0000000000b1', 'Marc', 'Asugui', null, 'Marc Asugui'),
  ('00000000-0000-0000-0000-0000000000b2', 'Ashley', 'Santos', 'Ash', 'Ashley Santos'),
  ('00000000-0000-0000-0000-0000000000b4', 'Devin', 'Buth', null, 'Devin Buth'),
  (null, 'Kevin', 'Wong', null, 'Kevin Wong');
insert into public.community_profiles (user_id, username) values
  ('00000000-0000-0000-0000-0000000000a1', 'jared'), ('00000000-0000-0000-0000-0000000000b1', 'marc.asugui'),
  ('00000000-0000-0000-0000-0000000000b4', 'devinbuth');

-- Twelve starters and three placeholders, made the way 20270601090000 made them.
create function public.t_old_virtual(_slug text, _first text, _last text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, banned_until)
  values (v, _slug || '@virtual.jfeffect.invalid', jsonb_build_object('full_name', btrim(_first || ' ' || coalesce(_last, '')), 'jf_virtual', true), now() + interval '100 years');
  insert into auth.identities (provider_id, user_id, identity_data, provider)
  values (v::text, v, jsonb_build_object('sub', v::text, 'email', _slug || '@virtual.jfeffect.invalid'), 'email');
  insert into public.virtual_accounts (user_id, slug, first_name, last_name, created_at)
  values (v, _slug, _first, _last, now() - interval '1 day');
  insert into public.community_profiles (user_id, username, discoverable) values (v, _slug, false);
  insert into public.virtual_account_activity (user_id, action, detail) values (v, 'created', jsonb_build_object('slug', _slug));
  return v;
end $$;

select count(public.t_old_virtual(s, f, l)) as made from (values
  ('maya.lifts', 'Maya', 'Okafor'), ('theo.trains', 'Theo', 'Larsen'), ('priya.strong', 'Priya', 'Raman'),
  ('diego.pulls', 'Diego', 'Marín'), ('hannah.reps', 'Hannah', 'Reid'), ('kofi.benches', 'Kofi', 'Mensah'),
  ('ellie.moves', 'Ellie', 'Novak'), ('sam.at.home', 'Sam', 'Whitford'), ('aiyana.squats', 'Aiyana', 'Brooks'),
  ('graham.masters', 'Graham', 'Ellis'), ('lena.builds', 'Lena', 'Hoffmann'), ('jordan.newbie', 'Jordan', 'Pike'),
  ('jon.doe', 'Jon', 'Doe'), ('jane.doe.lifts', 'Jane', 'Doe'), ('testuser3', 'Test', 'User')
) x(s, f, l);

-- Jon Doe has a like on Marc's post, a follower and history: all of it must stay his.
insert into public.community_posts (id, author_user_id) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1');
insert into public.community_reactions (post_id, user_id, emoji)
select '00000000-0000-0000-0000-0000000000f1', v.user_id, 'heart' from public.virtual_accounts v where v.slug = 'jon.doe';
insert into public.community_follows (follower_id, followee_id)
select '00000000-0000-0000-0000-0000000000b4', v.user_id from public.virtual_accounts v where v.slug = 'jon.doe';
insert into public.virtual_account_activity (user_id, action, post_id, detail)
select v.user_id, 'like', '00000000-0000-0000-0000-0000000000f1', '{"by":"automation"}' from public.virtual_accounts v where v.slug = 'jon.doe';
create table public.t_before as select v.user_id, v.slug, v.first_name, v.last_name from public.virtual_accounts v;
