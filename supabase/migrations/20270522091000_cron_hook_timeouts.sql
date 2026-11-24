-- Every scheduled hook call waits for its answer (Nov 24 2026).
--
-- Eight cron jobs called their hook with net.http_post and no timeout_milliseconds, so pg_net gave
-- each its default of 5 seconds. lift-archive-tick-2m copies up to five lift videos to Google
-- Drive a run and timed out 88 times in two days (appointment-reminders-tick too, now and then).
-- When one of those calls hits its 5 seconds, pg_net drops the other calls it sent in the same
-- moment: all 9 "Client cancelled" (499) answers in those two days came within 5 seconds of one,
-- every one on an even minute, which is how the training-roadmap-tick run at :28 and :58 wrote
-- nothing. Each of those jobs now waits as long as the others do (2 minutes; the nightly media
-- archive 5). Only a job with no timeout at all is changed, and only its timeout.

do $$
declare
  j record;
  wait_ms int;
begin
  for j in
    select jobid, jobname, command
      from cron.job
     where command ilike '%net.http_post%'
       and command not ilike '%timeout_milliseconds%'
       and command ~ 'body\s*:=\s*''\{\}''::jsonb\s*\)'
  loop
    wait_ms := case when j.jobname = 'media-archive-nightly' then 300000 else 120000 end;
    perform cron.alter_job(
      job_id := j.jobid,
      command := regexp_replace(
        j.command,
        '(body\s*:=\s*''\{\}''::jsonb)(\s*\))',
        '\1, timeout_milliseconds := ' || wait_ms || '\2'
      )
    );
  end loop;
end $$;
