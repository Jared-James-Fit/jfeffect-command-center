-- Minimal stand-ins for the app tables the coaching-agreement migration touches.
-- Mirrors the real guard on clients so the tests prove the server path (auth.uid()
-- is null) passes it while a client's own session is refused.
-- Roles are cluster-wide, so create them only if a previous run left them behind.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create table public.auth_ctx (uid uuid);
insert into public.auth_ctx values (null);
create function auth.uid() returns uuid language sql stable as $$ select uid from public.auth_ctx limit 1 $$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on public.auth_ctx to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create type public.app_role as enum ('admin', 'client', 'coach', 'media_manager', 'member');
create table public.user_roles (user_id uuid, role public.app_role);
create function public.has_role(_user_id uuid, _role public.app_role)
  returns boolean language sql stable security definer set search_path = public
  as $$ select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;

create table public.coaches (id uuid primary key default gen_random_uuid(), user_id uuid, archived boolean default false, status text default 'Active');

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  assigned_coach_id uuid,
  full_name text not null default 'Test Client',
  email text,
  phone text,
  address text,
  city text,
  province text,
  postal_code text,
  country text,
  emergency_contact_name text,
  emergency_contact_phone text,
  date_of_birth date,
  agreement_signed boolean not null default false,
  agreement_signed_date date,
  agreement_version text,
  agreement_status text not null default 'Not Sent',
  archived boolean not null default false,
  status text default 'Active'
);

create function public.is_assigned_coach(_client_id uuid)
  returns boolean language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from clients c join coaches co on co.id = c.assigned_coach_id
       where c.id = _client_id and co.user_id = auth.uid() and co.archived = false and co.status = 'Active')
  $$;

-- Same behaviour as the real clients_block_self_privileged_updates trigger for the
-- columns that matter here.
create function public.clients_block_self_privileged_updates() returns trigger
  language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or public.has_role(uid, 'admin'::public.app_role) then return new; end if;
  if new.user_id is distinct from uid and old.user_id is distinct from uid then return new; end if;
  if new.agreement_signed is distinct from old.agreement_signed
     or new.agreement_status is distinct from old.agreement_status then
    raise exception 'clients: clients may not modify agreement fields on their own row' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger clients_block_self_privileged_updates before update on public.clients
  for each row execute function public.clients_block_self_privileged_updates();

create function public.tg_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create table public.legal_consent_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  client_id uuid,
  consent_key text not null,
  granted boolean not null,
  updated_at timestamptz not null default now(),
  unique (user_id, consent_key)
);

create function public.t_assert(_ok boolean, _msg text) returns void language plpgsql as $$
begin
  if not coalesce(_ok, false) then raise exception 'ASSERT FAILED: %', _msg; end if;
  raise notice 'ok: %', _msg;
end $$;
