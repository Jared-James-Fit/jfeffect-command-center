-- "You're booked in": a session booked for a client tells them, in their coach
-- chat (the session as a card) with a push, whichever screen booked it.
--
-- Nov 10 2026: the coach booked Devin for 4 PM the next day from his chat and
-- Devin got nothing from the app; the coach typed "Booked you in for 4pm
-- tomorrow ✅" himself. Every booking stored send_confirmation_email = true and
-- nothing ever read it, so confirmation_sent_at was never written for anyone.
-- The evening-before text doesn't cover it either: a session arranged after
-- 6 PM the day before is never reminded ("arranged_recently").
--
-- Who's told: a Scheduled session the client can see, still ahead, booked in
-- the last 2 days, with send_confirmation_email on, that they didn't book
-- themselves (booked_via 'client_app' / 'booking_page') and that the coach's
-- Google didn't bring in ('google_calendar'), and not already announced
-- (confirmation_sent_at). An approved session request says so in its own
-- message and stamps confirmation_sent_at itself. The same rule is
-- shouldAnnounceBooking in src/lib/session-booked.ts.
--
-- 1. Inserting a booking calls the session-bookings-tick hook at once (pg_net
--    sends it after commit), only for the first of a spree: Book ahead writes
--    a client's sessions one by one, and the hook waits for them all and
--    sends one message.
-- 2. pg_cron every minute calls it again while a booking has waited 20 s.

-- What was booked before this existed is history, never announced late.
-- (Devin's Nov 11 4 PM, booked at 02:39:44 UTC, is the first one told.)
update public.pt_sessions
   set confirmation_sent_at = created_at
 where confirmation_sent_at is null
   and created_at < '2026-11-11 02:39:00+00';

create index if not exists pt_sessions_unannounced_idx
  on public.pt_sessions (created_at)
  where confirmation_sent_at is null;

create or replace function public.pt_sessions_booked_kick()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
      from new_rows n
     where n.status = 'Scheduled'
       and coalesce(n.visible_to_client, true)
       and coalesce(n.send_confirmation_email, true)
       and n.confirmation_sent_at is null
       and coalesce(n.booked_via, '') not in ('client_app', 'booking_page', 'google_calendar')
       and n.starts_at > now()
       -- Only the first of a spree: the hook already running waits for the rest.
       and not exists (
         select 1
           from public.pt_sessions p
          where p.client_id = n.client_id
            and p.confirmation_sent_at is null
            and p.status = 'Scheduled'
            and coalesce(p.visible_to_client, true)
            and coalesce(p.send_confirmation_email, true)
            and coalesce(p.booked_via, '') not in ('client_app', 'booking_page', 'google_calendar')
            and p.starts_at > now()
            and p.created_at > now() - interval '2 days'
            and p.id not in (select id from new_rows)
       )
  ) then
    begin
      perform net.http_post(
        url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/session-bookings-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    exception when others then
      -- Never fail the booking; the every-minute job picks it up.
      null;
    end;
  end if;
  return null;
end;
$$;

revoke all on function public.pt_sessions_booked_kick() from public, anon, authenticated;

drop trigger if exists pt_sessions_booked_kick on public.pt_sessions;
create trigger pt_sessions_booked_kick
  after insert on public.pt_sessions
  referencing new table as new_rows
  for each statement execute function public.pt_sessions_booked_kick();

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'session-bookings-tick';
  perform cron.schedule(
    'session-bookings-tick',
    '* * * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/session-bookings-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) as request_id
    where exists (
      select 1 from public.pt_sessions p
       where p.confirmation_sent_at is null
         and p.created_at > now() - interval '2 days'
         and p.created_at < now() - interval '20 seconds'
         and p.status = 'Scheduled'
         and coalesce(p.visible_to_client, true)
         and coalesce(p.send_confirmation_email, true)
         and coalesce(p.booked_via, '') not in ('client_app', 'booking_page', 'google_calendar')
         and p.starts_at > now()
    );
    $cmd$
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;
