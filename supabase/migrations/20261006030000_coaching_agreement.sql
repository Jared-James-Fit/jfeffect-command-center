-- Coaching Agreement: in-app e-signature for the JF Effect Coaching Agreement.
--
-- Additive and idempotent. Nothing existing is altered by this file; the only
-- change to existing data happens later, at signing time, inside
-- coaching_agreement_record_signature() (see below).
--
--   coaching_agreement_versions     immutable store of the exact text that was signed
--   coaching_agreement_signatures   append-only signature evidence (one row per signing)
--   coaching_agreement_client_state per-client admin state: "send another one",
--                                   paper / not-required exemption, reminder stamps
--   coaching_agreement_events       audit trail
--
-- Every write comes from the server (service role). Clients can read only their own
-- rows; admins and the assigned coach can read their clients' rows.
--
-- Signing is ONE atomic SECURITY DEFINER function so the evidence row, the
-- clients.agreement_* mirror that the legacy screens read (sale dialog, purchase
-- pages, clients directory), the consent preferences and the audit event can never
-- drift apart. The clients table guards its agreement columns against the client's
-- own session, so the function must run as the trusted server (auth.uid() is null),
-- which is why EXECUTE is granted to service_role only.

-- 1) Versions ---------------------------------------------------------------
create table if not exists public.coaching_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  content_hash text not null unique check (content_hash ~ '^[a-f0-9]{64}$'),
  content_json text not null,
  effective_date date not null,
  created_at timestamptz not null default now()
);

create or replace function public.tg_coaching_agreement_versions_immutable()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  raise exception 'Coaching agreement versions are immutable. Publish a new version instead.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists trg_coaching_agreement_versions_immutable on public.coaching_agreement_versions;
create trigger trg_coaching_agreement_versions_immutable
  before update or delete on public.coaching_agreement_versions
  for each row execute function public.tg_coaching_agreement_versions_immutable();

-- 2) Signatures -------------------------------------------------------------
create table if not exists public.coaching_agreement_signatures (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.coaching_agreement_versions(id),
  -- Nulled (not deleted) if the client or account is later removed; the name and
  -- email below keep the record meaningful as evidence.
  client_id uuid references public.clients(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  client_name text not null,
  client_email text,
  typed_name text not null check (length(btrim(typed_name)) >= 3),
  signature_method text not null check (signature_method in ('drawn', 'typed')),
  signature_image text,
  details jsonb not null default '{}'::jsonb,
  acknowledgements jsonb not null default '[]'::jsonb,
  optional_consents jsonb not null default '{}'::jsonb,
  guardian jsonb,
  review jsonb not null default '{}'::jsonb,
  intent_statement text not null,
  signed_at timestamptz not null default now(),
  signer_timezone text,
  ip_address text,
  user_agent text,
  verification_method text not null default 'authenticated_session',
  idempotency_key text,
  receipt_emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists coaching_agreement_signatures_client_idx
  on public.coaching_agreement_signatures (client_id, signed_at desc);
create index if not exists coaching_agreement_signatures_user_idx
  on public.coaching_agreement_signatures (user_id, signed_at desc);
create unique index if not exists coaching_agreement_signatures_idem_uidx
  on public.coaching_agreement_signatures (user_id, idempotency_key)
  where user_id is not null and idempotency_key is not null;

-- Signatures are legal evidence: never deleted, never edited. Only delivery
-- bookkeeping (receipt_emailed_at) may change, and client_id / user_id may be
-- cleared when the underlying client or account is removed.
create or replace function public.tg_coaching_agreement_signature_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Coaching agreement signatures are permanent records and cannot be deleted'
      using errcode = 'check_violation';
  end if;

  if new.id is distinct from old.id
     or new.version_id is distinct from old.version_id
     or new.client_name is distinct from old.client_name
     or new.client_email is distinct from old.client_email
     or new.typed_name is distinct from old.typed_name
     or new.signature_method is distinct from old.signature_method
     or new.signature_image is distinct from old.signature_image
     or new.details is distinct from old.details
     or new.acknowledgements is distinct from old.acknowledgements
     or new.optional_consents is distinct from old.optional_consents
     or new.guardian is distinct from old.guardian
     or new.review is distinct from old.review
     or new.intent_statement is distinct from old.intent_statement
     or new.signed_at is distinct from old.signed_at
     or new.signer_timezone is distinct from old.signer_timezone
     or new.ip_address is distinct from old.ip_address
     or new.user_agent is distinct from old.user_agent
     or new.verification_method is distinct from old.verification_method
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at
     or (new.client_id is distinct from old.client_id and new.client_id is not null)
     or (new.user_id is distinct from old.user_id and new.user_id is not null)
  then
    raise exception 'Coaching agreement signatures are immutable'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_coaching_agreement_signature_guard on public.coaching_agreement_signatures;
create trigger trg_coaching_agreement_signature_guard
  before update or delete on public.coaching_agreement_signatures
  for each row execute function public.tg_coaching_agreement_signature_guard();

-- 3) Per-client admin state -------------------------------------------------
create table if not exists public.coaching_agreement_client_state (
  client_id uuid primary key references public.clients(id) on delete cascade,
  -- "Send another one": the client must sign again if their latest signature is
  -- older than this.
  resign_requested_at timestamptz,
  resign_requested_by uuid references auth.users(id) on delete set null,
  resign_note text,
  -- Escape hatch for the mandatory popup: signed on paper, or not required
  -- (staff, test accounts, family).
  exempt_kind text check (exempt_kind in ('offline_signed', 'not_required')),
  exempt_note text,
  exempt_set_at timestamptz,
  exempt_set_by uuid references auth.users(id) on delete set null,
  last_reminded_at timestamptz,
  reminder_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_coaching_agreement_client_state_updated_at on public.coaching_agreement_client_state;
create trigger trg_coaching_agreement_client_state_updated_at
  before update on public.coaching_agreement_client_state
  for each row execute function public.tg_set_updated_at();

-- 4) Audit events -----------------------------------------------------------
create table if not exists public.coaching_agreement_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  signature_id uuid references public.coaching_agreement_signatures(id) on delete set null,
  event_type text not null,
  actor_user_id uuid,
  actor_role text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists coaching_agreement_events_client_idx
  on public.coaching_agreement_events (client_id, created_at desc);

-- 5) Privileges + RLS -------------------------------------------------------
alter table public.coaching_agreement_versions enable row level security;
alter table public.coaching_agreement_signatures enable row level security;
alter table public.coaching_agreement_client_state enable row level security;
alter table public.coaching_agreement_events enable row level security;

revoke all on public.coaching_agreement_versions from anon, authenticated;
revoke all on public.coaching_agreement_signatures from anon, authenticated;
revoke all on public.coaching_agreement_client_state from anon, authenticated;
revoke all on public.coaching_agreement_events from anon, authenticated;

grant select on public.coaching_agreement_versions to authenticated;
grant select on public.coaching_agreement_signatures to authenticated;
grant select on public.coaching_agreement_client_state to authenticated;
grant select on public.coaching_agreement_events to authenticated;

grant all on public.coaching_agreement_versions to service_role;
grant all on public.coaching_agreement_signatures to service_role;
grant all on public.coaching_agreement_client_state to service_role;
grant all on public.coaching_agreement_events to service_role;

-- The agreement text is not secret (it is shown before signing), so any signed-in
-- user may read versions.
drop policy if exists "Signed-in users read coaching agreement versions" on public.coaching_agreement_versions;
create policy "Signed-in users read coaching agreement versions"
  on public.coaching_agreement_versions
  for select to authenticated
  using (true);

drop policy if exists "Clients read own coaching agreement signatures" on public.coaching_agreement_signatures;
create policy "Clients read own coaching agreement signatures"
  on public.coaching_agreement_signatures
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Admins read all coaching agreement signatures" on public.coaching_agreement_signatures;
create policy "Admins read all coaching agreement signatures"
  on public.coaching_agreement_signatures
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Assigned coach reads coaching agreement signatures" on public.coaching_agreement_signatures;
create policy "Assigned coach reads coaching agreement signatures"
  on public.coaching_agreement_signatures
  for select to authenticated
  using (client_id is not null and public.is_assigned_coach(client_id));

drop policy if exists "Clients read own coaching agreement state" on public.coaching_agreement_client_state;
create policy "Clients read own coaching agreement state"
  on public.coaching_agreement_client_state
  for select to authenticated
  using (exists (
    select 1 from public.clients c
     where c.id = coaching_agreement_client_state.client_id
       and c.user_id = auth.uid()
  ));

drop policy if exists "Admins read all coaching agreement state" on public.coaching_agreement_client_state;
create policy "Admins read all coaching agreement state"
  on public.coaching_agreement_client_state
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Assigned coach reads coaching agreement state" on public.coaching_agreement_client_state;
create policy "Assigned coach reads coaching agreement state"
  on public.coaching_agreement_client_state
  for select to authenticated
  using (public.is_assigned_coach(client_id));

drop policy if exists "Admins read coaching agreement events" on public.coaching_agreement_events;
create policy "Admins read coaching agreement events"
  on public.coaching_agreement_events
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Assigned coach reads coaching agreement events" on public.coaching_agreement_events;
create policy "Assigned coach reads coaching agreement events"
  on public.coaching_agreement_events
  for select to authenticated
  using (client_id is not null and public.is_assigned_coach(client_id));

-- 6) Atomic signing ---------------------------------------------------------
-- Called only by the server after it has authenticated the user, verified the
-- agreement hash and re-validated every field. Returns {id, duplicate}.
create or replace function public.coaching_agreement_record_signature(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := nullif(p ->> 'user_id', '')::uuid;
  v_client_id uuid := nullif(p ->> 'client_id', '')::uuid;
  v_version_id uuid := nullif(p ->> 'version_id', '')::uuid;
  v_idem text := nullif(p ->> 'idempotency_key', '');
  v_version text;
  v_client public.clients%rowtype;
  v_existing uuid;
  v_sig uuid;
  v_now timestamptz := now();
  v_details jsonb := coalesce(p -> 'details', '{}'::jsonb);
  v_consents jsonb := coalesce(p -> 'optional_consents', '{}'::jsonb);
  v_is_minor boolean := coalesce((v_details ->> 'is_minor')::boolean, false);
  v_consent_key text;
begin
  if v_user is null or v_client_id is null or v_version_id is null then
    raise exception 'user_id, client_id and version_id are required' using errcode = '22023';
  end if;
  if p ->> 'signature_method' not in ('drawn', 'typed') then
    raise exception 'Unsupported signature method' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'acknowledgements') is distinct from 'array'
     or jsonb_array_length(p -> 'acknowledgements') = 0 then
    raise exception 'Acknowledgements are required' using errcode = '22023';
  end if;
  if v_is_minor and (p -> 'guardian' is null or jsonb_typeof(p -> 'guardian') <> 'object') then
    raise exception 'A parent or guardian signature is required for a minor' using errcode = '22023';
  end if;

  select version into v_version from public.coaching_agreement_versions where id = v_version_id;
  if v_version is null then
    raise exception 'Unknown agreement version' using errcode = '22023';
  end if;

  -- Lock the client row: a double tap or a retry waits here, then finds the first
  -- signature below instead of creating a second one.
  select * into v_client from public.clients where id = v_client_id and user_id = v_user for update;
  if not found then
    raise exception 'Client not found for this user' using errcode = '42501';
  end if;

  if v_idem is not null then
    select id into v_existing from public.coaching_agreement_signatures
     where user_id = v_user and idempotency_key = v_idem;
    if v_existing is not null then
      return jsonb_build_object('id', v_existing, 'duplicate', true);
    end if;
  end if;

  insert into public.coaching_agreement_signatures (
    version_id, client_id, user_id, client_name, client_email, typed_name,
    signature_method, signature_image, details, acknowledgements, optional_consents,
    guardian, review, intent_statement, signed_at, signer_timezone, ip_address,
    user_agent, idempotency_key
  ) values (
    v_version_id, v_client.id, v_user,
    coalesce(nullif(btrim(p ->> 'client_name'), ''), v_client.full_name, 'Unknown'),
    nullif(btrim(p ->> 'client_email'), ''),
    btrim(p ->> 'typed_name'),
    p ->> 'signature_method',
    nullif(p ->> 'signature_image', ''),
    v_details,
    p -> 'acknowledgements',
    v_consents,
    case when jsonb_typeof(p -> 'guardian') = 'object' then p -> 'guardian' else null end,
    coalesce(p -> 'review', '{}'::jsonb),
    p ->> 'intent_statement',
    v_now,
    nullif(p ->> 'signer_timezone', ''),
    nullif(p ->> 'ip_address', ''),
    nullif(p ->> 'user_agent', ''),
    v_idem
  )
  returning id into v_sig;

  -- Mirror onto the client row so every existing screen that reads
  -- clients.agreement_* (sale dialog, purchase pages, clients directory) is correct.
  -- Contact details the client confirmed while signing fill or refresh the profile;
  -- an existing date of birth is never overwritten.
  update public.clients c set
    agreement_signed = true,
    agreement_signed_date = (v_now at time zone 'America/Winnipeg')::date,
    agreement_status = 'Signed',
    agreement_version = 'v' || v_version,
    phone = coalesce(nullif(btrim(v_details ->> 'phone'), ''), c.phone),
    address = coalesce(nullif(btrim(v_details #>> '{address,street}'), ''), c.address),
    city = coalesce(nullif(btrim(v_details #>> '{address,city}'), ''), c.city),
    province = coalesce(nullif(btrim(v_details #>> '{address,province}'), ''), c.province),
    postal_code = coalesce(nullif(btrim(v_details #>> '{address,postal_code}'), ''), c.postal_code),
    country = coalesce(nullif(btrim(v_details #>> '{address,country}'), ''), c.country),
    emergency_contact_name = coalesce(nullif(btrim(v_details #>> '{emergency_contact_1,name}'), ''), c.emergency_contact_name),
    emergency_contact_phone = coalesce(nullif(btrim(v_details #>> '{emergency_contact_1,phone}'), ''), c.emergency_contact_phone),
    date_of_birth = coalesce(c.date_of_birth, nullif(v_details ->> 'date_of_birth', '')::date)
  where c.id = v_client.id;

  -- Optional media permissions land in the same preferences the client already
  -- manages under Legal & Safety, so the two screens never disagree.
  if to_regclass('public.legal_consent_preferences') is not null then
    for v_consent_key in select jsonb_object_keys(v_consents) loop
      if v_consent_key in ('testimonial_use', 'social_publication') then
        insert into public.legal_consent_preferences (user_id, client_id, consent_key, granted)
        values (v_user, v_client.id, v_consent_key, coalesce((v_consents ->> v_consent_key)::boolean, false))
        on conflict (user_id, consent_key) do update
          set granted = excluded.granted,
              client_id = excluded.client_id,
              updated_at = now();
      end if;
    end loop;
  end if;

  insert into public.coaching_agreement_events
    (client_id, signature_id, event_type, actor_user_id, actor_role, details)
  values (
    v_client.id, v_sig, 'signed', v_user, 'client',
    jsonb_build_object(
      'version', v_version,
      'method', p ->> 'signature_method',
      'minor', v_is_minor
    )
  );

  return jsonb_build_object('id', v_sig, 'duplicate', false);
end;
$$;

revoke all on function public.coaching_agreement_record_signature(jsonb) from public, anon, authenticated;
grant execute on function public.coaching_agreement_record_signature(jsonb) to service_role;
