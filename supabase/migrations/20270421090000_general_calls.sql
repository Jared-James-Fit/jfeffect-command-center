-- General calls: a booking type for the calls a coach has with the people he
-- already coaches (a check-in, the program, nutrition, anything), beside the
-- Coaching Discovery Call, which stays for people who aren't clients yet.
--
-- booking_cards.duration_options: the lengths a booker can pick (null = the
--   type's one length, duration_minutes). duration_minutes is the one the page
--   opens on. A coach sending the link picks the length for them instead.
-- booking_cards.audience: who can book it online.
--   'anyone'  = anyone with the link (the discovery call; a public booking is
--               an appointment and never touches credits, as before)
--   'clients' = only a coaching client, signed in or through a personal link
--               the coach sent (src/lib/booking.functions.ts refuses anyone
--               else, and a JF member never sees it in their app)
--
-- The "1:1 Meeting" type (30 min video, booked once, never online) becomes
-- General Call rather than adding a second call type beside it. Guarded: only
-- while it's still exactly as it was, so a coach's own edits stay his. Safe to
-- run again.

alter table public.booking_cards
  add column if not exists duration_options smallint[],
  add column if not exists audience text not null default 'anyone';

alter table public.booking_cards drop constraint if exists booking_cards_audience_check;
alter table public.booking_cards add constraint booking_cards_audience_check
  check (audience in ('anyone', 'clients'));

alter table public.booking_cards drop constraint if exists booking_cards_duration_options_check;
alter table public.booking_cards add constraint booking_cards_duration_options_check
  check (
    duration_options is null
    or (
      cardinality(duration_options) between 1 and 6
      and 5 <= all (duration_options)
      and 240 >= all (duration_options)
    )
  );

comment on column public.booking_cards.duration_options is
  'Lengths (minutes) a booker can pick on the booking page; null = only duration_minutes. duration_minutes is the default.';
comment on column public.booking_cards.audience is
  'Who can book it online: anyone (a public link) or clients (coaching clients only: signed in, or a personal link from the coach).';

-- The 1:1 Meeting becomes General Call.
update public.booking_cards
   set name = 'General Call',
       slug = 'general-call',
       online_enabled = true,
       show_in_app = true,
       audience = 'clients',
       duration_minutes = 30,
       duration_options = '{15,30,45,60}',
       location_mode = 'video',
       location = 'Video call (Google Meet)',
       description = 'A call with your coach about anything: a check-in, your program, nutrition or a question.',
       collect_phone = false,
       collect_notes = true,
       min_notice_hours = 12,
       max_advance_days = 30,
       buffer_minutes = 10,
       uses_credit = false,
       follows_smart = true
 where id = 'e7de6cbb-7bb4-46a3-aea2-73f22103639d'
   and name = '1:1 Meeting'
   and slug is null
   and not exists (select 1 from public.booking_cards c where c.slug = 'general-call');

-- Anywhere that never had a 1:1 Meeting (a fresh database): make one.
insert into public.booking_cards (
  name, session_type, custom_type, duration_minutes, location, default_notes,
  visible_to_client, client_visible_notes, reminders_enabled, send_confirmation_email,
  uses_credit, color, is_active, sort_order,
  slug, online_enabled, show_in_app, location_mode, description, timezone,
  min_notice_hours, max_advance_days, buffer_minutes, max_per_day, collect_phone, collect_notes,
  follows_smart, audience, duration_options
)
select
  'General Call', 'Consultation', null, 30, 'Video call (Google Meet)', null,
  true, true, true, true,
  false, 'green', true, 20,
  'general-call', true, true, 'video',
  'A call with your coach about anything: a check-in, your program, nutrition or a question.',
  'America/Winnipeg',
  12, 30, 10, null, false, true,
  true, 'clients', '{15,30,45,60}'
where not exists (select 1 from public.booking_cards c where c.slug = 'general-call');

-- Its hours (used until he confirms his smart availability, then only in
-- Manual): the discovery call's, else weekdays 9 to 5.
insert into public.booking_card_hours (booking_card_id, day_of_week, start_time, end_time)
select g.id, h.day_of_week, h.start_time, h.end_time
  from public.booking_cards g
  join public.booking_cards d on d.slug = 'coaching-discovery'
  join public.booking_card_hours h on h.booking_card_id = d.id
 where g.slug = 'general-call'
   and not exists (select 1 from public.booking_card_hours x where x.booking_card_id = g.id);

insert into public.booking_card_hours (booking_card_id, day_of_week, start_time, end_time)
select g.id, dow, '09:00', '17:00'
  from public.booking_cards g, generate_series(1, 5) as dow
 where g.slug = 'general-call'
   and not exists (select 1 from public.booking_card_hours x where x.booking_card_id = g.id);
