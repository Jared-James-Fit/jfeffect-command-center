-- Smart availability (src/lib/smart-availability.ts): the coach's booking
-- boundaries in one row, his changes for single dates, and which booking
-- types follow them. Nothing changes for anyone booking until he confirms his
-- boundaries in Calendar → Booking (settings.confirmedAt): until then every
-- type offers exactly what its own weekly hours offered before.

create table if not exists public.booking_availability (
  id boolean primary key default true check (id),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table public.booking_availability is
  'One row: the coach''s smart availability settings (mode, boundaries, protected time, limits), read by booking.server.ts through sanitizeAvailability.';

insert into public.booking_availability (id, settings) values (true, '{}'::jsonb)
on conflict (id) do nothing;

create table if not exists public.booking_availability_overrides (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  kind text not null check (kind in ('block', 'open', 'off', 'smart')),
  start_time time,
  end_time time,
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint booking_availability_overrides_times check (
    (kind in ('block', 'open') and start_time is not null and end_time is not null and end_time > start_time)
    or (kind in ('off', 'smart') and start_time is null and end_time is null)
  )
);
comment on table public.booking_availability_overrides is
  'The coach''s changes for one date: block time, open extra time, a day off, or (Assisted) use the smart picks that day. Also what learnFromOverrides reads.';
create index if not exists booking_availability_overrides_date_idx on public.booking_availability_overrides (date);
create unique index if not exists booking_availability_overrides_day_kind_key
  on public.booking_availability_overrides (date, kind) where kind in ('off', 'smart');

alter table public.booking_availability enable row level security;
alter table public.booking_availability_overrides enable row level security;

drop policy if exists "Coaches and admins manage availability" on public.booking_availability;
create policy "Coaches and admins manage availability" on public.booking_availability
  for all using ((select public.is_coach_or_admin((select auth.uid()))))
  with check ((select public.is_coach_or_admin((select auth.uid()))));

drop policy if exists "Coaches and admins manage availability changes" on public.booking_availability_overrides;
create policy "Coaches and admins manage availability changes" on public.booking_availability_overrides
  for all using ((select public.is_coach_or_admin((select auth.uid()))))
  with check ((select public.is_coach_or_admin((select auth.uid()))));
-- The public booking page reads both through server functions (service role).

-- Which booking types follow it: calls and meetings do, training sessions keep their own hours.
alter table public.booking_cards add column if not exists follows_smart boolean not null default false;
comment on column public.booking_cards.follows_smart is
  'Online times come from the coach''s smart availability (boundaries, protected time, limits, smart picks) instead of only this type''s weekly hours. Off for training sessions.';
update public.booking_cards
set follows_smart = true
where follows_smart = false
  and coalesce(uses_credit, false) = false
  and session_type not in ('Personal Training Session', 'Technique Session', 'Powerlifting Session',
                           'Bodybuilding Session', 'Assessment Session', 'Custom Session');

-- The discovery call's hours were saved in New York time (a phone's zone at the time),
-- which is an hour off Manitoba from March to November. Its 9–5 means the coach's 9–5.
update public.booking_cards
set timezone = 'America/Winnipeg'
where slug = 'coaching-discovery' and timezone = 'America/New_York';

select public.rls_evaluate_once('booking_availability');
select public.rls_evaluate_once('booking_availability_overrides');
