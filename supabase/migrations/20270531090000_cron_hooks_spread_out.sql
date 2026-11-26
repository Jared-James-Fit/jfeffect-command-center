-- Scheduled hook calls take turns instead of landing in the same second (Nov 26 2026).
--
-- The app's server runs each request in a shared worker; when several land in the same second,
-- the worker can run out of memory and the host kills every request in it (Cloudflare 1102). Over
-- the 6 hours to Nov 26 00:24 UTC, 6 calls died that way, 4 of them at a minute ending in 0, when
-- four jobs fired together (ai-health-tick, appointment-reminders-tick, sms-unread-reminders and
-- lift-archive-tick-2m): 1 in 9 of those minutes lost a call, against about 1 in 160 of the rest.
-- The 1102s that day hit ai-health-tick and appointment-reminders-tick; on Nov 23 they cut off
-- Generate Next Program's runs at the quarter hours.
--
-- 1. Three always-on jobs move to minutes of their own (each still runs as often as before):
--      ai-health-tick             */5  → 2-59/5   (:02, :07, …: its hourly and 9am parts read
--                                                 "the first 5 minutes of the hour", still once)
--      appointment-reminders-tick */5  → 4-59/5   (:04, :09, …: its windows are from "now")
--      sms-unread-reminders       */10 → 8-59/10  (:08, :18, …)
--    so no minute starts more than two always-on calls (it was four).
-- 2. Two jobs ask the database first and call the app only when there's work, like
--    program-intel-tick does: lift-archive-tick-2m (lift_videos to copy to Drive: none on Nov 26,
--    yet it called the app 720 times a day) and training-roadmap-tick (pl_roadmap_queue entries
--    past their 2-minute settle, runRoadmapTick's own SETTLE_MS; 288 calls a day).
--
-- Only a job still on the schedule or command it had is changed, so a later change by hand stays.

do $$
declare
  j record;
begin
  for j in
    select jobid, jobname, schedule
      from cron.job
     where (jobname, schedule) in (
       ('ai-health-tick', '*/5 * * * *'),
       ('appointment-reminders-tick', '*/5 * * * *'),
       ('sms-unread-reminders', '*/10 * * * *')
     )
  loop
    perform cron.alter_job(
      job_id := j.jobid,
      schedule := case j.jobname
        when 'ai-health-tick' then '2-59/5 * * * *'
        when 'appointment-reminders-tick' then '4-59/5 * * * *'
        when 'sms-unread-reminders' then '8-59/10 * * * *'
      end
    );
  end loop;

  for j in
    select jobid, jobname, command
      from cron.job
     where jobname in ('lift-archive-tick-2m', 'training-roadmap-tick')
       and command ~* '\)\s*as\s+request_id\s*;?\s*$'
       and command !~* 'where\s+exists'
  loop
    perform cron.alter_job(
      job_id := j.jobid,
      command := regexp_replace(
        j.command,
        '(\)\s*as\s+request_id)\s*;?\s*$',
        '\1' || case j.jobname
          when 'lift-archive-tick-2m' then
            E'\n    where exists (\n      select 1 from public.lift_videos\n'
            || E'       where archive_status in (''pending'', ''failed'')\n'
            || E'         and video_storage_path is not null\n'
            || E'         and archive_attempts < 5\n'
            || E'         and (archive_next_attempt_at is null or archive_next_attempt_at <= now())\n    );'
          else
            E'\n    where exists (\n      select 1 from public.pl_roadmap_queue\n'
            || E'       where queued_at <= now() - interval ''2 minutes''\n    );'
        end
      )
    );
  end loop;
exception
  when undefined_table or undefined_function then
    null;
end
$$;
