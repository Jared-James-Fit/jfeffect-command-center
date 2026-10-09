-- Online booking (Calendly-style) on booking types.
--
-- A booking type (booking_cards row: "1:1 Training", "1:1 Meeting", ...) is
-- what gets booked. It can now also be booked online: its own link
-- (/book/<slug>), weekly hours (booking_card_hours, several windows per day)
-- and booking rules. One list for both jobs, instead of booking cards for
-- in-app booking plus a separate booking_links table for links.
--
-- Who books decides what is created (src/lib/booking.server.ts):
--   * a client we know is them (signed in, or a personal link the coach sent)
--     -> a pt_sessions row (credits reserve through the existing status
--     trigger when the type uses one, evening-before text, Google sync, shows
--     in their app and calendar feed)
--   * anyone else (incl. someone typing a client's email) -> an appointments
--     row with a Google invite; never anyone's credits
--
-- booking_links / booking_link_availability are retired: their one link
-- ("coaching-discovery", used by the coaching application flow) moves here
-- with the same slug, so shared URLs and app settings keep working.

-- ── Booking types: online booking settings ───────────────────────────────────
alter table public.booking_cards
  add column if not exists slug text,
  add column if not exists online_enabled boolean not null default false,
  add column if not exists show_in_app boolean not null default true,
  add column if not exists location_mode text not null default 'in_person',
  add column if not exists description text,
  add column if not exists timezone text not null default 'America/Winnipeg',
  add column if not exists min_notice_hours integer not null default 12,
  add column if not exists max_advance_days integer not null default 60,
  add column if not exists buffer_minutes integer not null default 0,
  add column if not exists max_per_day integer,
  add column if not exists collect_phone boolean not null default true,
  add column if not exists collect_notes boolean not null default true;

alter table public.booking_cards drop constraint if exists booking_cards_location_mode_check;
alter table public.booking_cards add constraint booking_cards_location_mode_check
  check (location_mode in ('in_person', 'video', 'phone'));
alter table public.booking_cards drop constraint if exists booking_cards_online_rules_check;
alter table public.booking_cards add constraint booking_cards_online_rules_check check (
  min_notice_hours between 0 and 720
  and max_advance_days between 1 and 365
  and buffer_minutes between 0 and 240
  and (max_per_day is null or max_per_day between 1 and 50)
);
alter table public.booking_cards drop constraint if exists booking_cards_slug_format_check;
alter table public.booking_cards add constraint booking_cards_slug_format_check
  check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
create unique index if not exists booking_cards_slug_key on public.booking_cards (slug) where slug is not null;

-- Weekly hours, in the type's time zone. Several rows per day = several windows.
create table if not exists public.booking_card_hours (
  id uuid primary key default gen_random_uuid(),
  booking_card_id uuid not null references public.booking_cards(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint booking_card_hours_order_check check (end_time > start_time)
);
create index if not exists booking_card_hours_card_idx on public.booking_card_hours (booking_card_id);

alter table public.booking_card_hours enable row level security;
drop policy if exists "Coaches and admins manage booking hours" on public.booking_card_hours;
create policy "Coaches and admins manage booking hours" on public.booking_card_hours
  for all using (public.is_coach_or_admin(auth.uid())) with check (public.is_coach_or_admin(auth.uid()));
-- Public pages and clients read hours through server functions (service role).

-- ── Sessions: how they were booked, and video calls ──────────────────────────
alter table public.pt_sessions
  add column if not exists booked_via text,
  add column if not exists wants_meet boolean not null default false,
  add column if not exists meet_link text;
alter table public.pt_sessions drop constraint if exists pt_sessions_booked_via_check;
alter table public.pt_sessions add constraint pt_sessions_booked_via_check
  check (booked_via is null or booked_via in ('client_app', 'booking_page'));
comment on column public.pt_sessions.booked_via is
  'Set when the client booked it themselves (client_app = signed in, booking_page = their personal link). Null = booked by staff.';
comment on column public.pt_sessions.wants_meet is
  'Video-call session: the Google sync adds a Meet link when it creates the event and stores it in meet_link.';

-- ── Two people, one slot ──────────────────────────────────────────────────────
-- An online booking holds its time here for the moment between the final
-- availability check and the insert. Overlapping holds are refused by the
-- database, so two people tapping the same time can't both get it. Holds are
-- deleted right after the booking is written; anything older than a couple of
-- minutes is a leftover and is cleared before the next claim.
create table if not exists public.booking_slot_claims (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint booking_slot_claims_order_check check (ends_at > starts_at),
  constraint booking_slot_claims_no_overlap exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&)
);
alter table public.booking_slot_claims enable row level security;
-- No policies: only the server (service role) touches holds.

-- ── Appointments: which booking type they came from ──────────────────────────
alter table public.appointments
  add column if not exists booking_card_id uuid references public.booking_cards(id) on delete set null;
create index if not exists appointments_booking_card_idx on public.appointments (booking_card_id, starts_at);
create index if not exists pt_sessions_booking_card_date_idx on public.pt_sessions (booking_card_id, session_date);

-- ── Move the old booking link over (same slug) ───────────────────────────────
insert into public.booking_cards (
  name, session_type, custom_type, duration_minutes, location, default_notes,
  visible_to_client, client_visible_notes, reminders_enabled, send_confirmation_email,
  uses_credit, color, is_active, sort_order,
  slug, online_enabled, show_in_app, location_mode, description, timezone,
  min_notice_hours, max_advance_days, buffer_minutes, max_per_day, collect_phone, collect_notes
)
select
  l.name, 'Consultation', null, l.duration_minutes,
  case when l.meet_enabled then 'Google Meet' else 'Phone call' end, null,
  true, true, true, true,
  false, 'green', true, 30,
  l.slug, l.active, false, case when l.meet_enabled then 'video' else 'phone' end, l.description, l.timezone,
  least(greatest(coalesce(l.min_notice_hours, 2), 0), 720),
  least(greatest(coalesce(l.max_advance_days, 60), 1), 365),
  least(greatest(coalesce(l.buffer_before_minutes, 0), coalesce(l.buffer_after_minutes, 0)), 240),
  case when l.max_per_day between 1 and 50 then l.max_per_day else null end,
  coalesce(l.collect_phone, true), coalesce(l.collect_notes, true)
from public.booking_links l
where l.slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  and not exists (select 1 from public.booking_cards c where c.slug = l.slug);

insert into public.booking_card_hours (booking_card_id, day_of_week, start_time, end_time)
select c.id, a.day_of_week, a.start_time, a.end_time
from public.booking_link_availability a
join public.booking_links l on l.id = a.booking_link_id
join public.booking_cards c on c.slug = l.slug
where a.end_time > a.start_time
  and not exists (select 1 from public.booking_card_hours h where h.booking_card_id = c.id);

-- Existing cards: a phone/video card is a video call when booked online.
update public.booking_cards
   set location_mode = 'video'
 where slug is null
   and location_mode = 'in_person'
   and (location ilike '%video%' or location ilike '%zoom%' or location ilike '%meet%');

comment on table public.booking_links is
  'Retired 2026-10: booking types live in booking_cards (online booking columns) + booking_card_hours. Kept for history only.';
comment on table public.booking_link_availability is
  'Retired 2026-10: see booking_card_hours.';
