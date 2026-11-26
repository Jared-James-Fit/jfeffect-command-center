-- Every scheduled hook call waits for its answer: the sweep that catches the rest (Nov 25 2026).
--
-- AGENTS.md: a pg_cron job that calls a hook says how long it waits (timeout_milliseconds, 2 minutes
-- unless the hook needs longer), because pg_net's default is 5 seconds and one timed-out call drops
-- the other calls sent in the same moment. 20270522091000_cron_hook_timeouts.sql fixed the jobs whose
-- body was exactly '{}'::jsonb. This finishes the job for any call it could not match.
--
-- About the two older jobs named in the task: payment-setup-reminders (20261007120000) and
-- messenger-checkin-reminders (20260920041000) are SQL only ("select public.run_...();"), they call
-- no hook, so they have no timeout to set and are left exactly as they are. The older job that does
-- call a hook without a timeout is payment-reminder-sms (same 20261007120000 migration), which the
-- earlier fix already covers; this sweep covers it too if that fix did not reach it.
--
-- Only a job whose command is a single hook call with no timeout is changed, and only its timeout
-- (the nightly media archive waits 5 minutes, every other job 2). Idempotent: a job that has a
-- timeout is never touched, so a second run changes nothing. Jobs it can't read safely are listed
-- in a notice and left alone.

do $$
declare
  j record;
  wait_ms int;
  fixed text;
begin
  for j in
    select jobid, jobname, command
      from cron.job
     where command ilike '%net.http_post%'
       and command not ilike '%timeout_milliseconds%'
  loop
    wait_ms := case when j.jobname = 'media-archive-nightly' then 300000 else 120000 end;
    -- the closing bracket of the one hook call at the end of the command, with or without "as request_id;"
    if (select count(*) from regexp_matches(j.command, 'net\.http_post', 'gi')) = 1
       and j.command ~* '\)\s*(as\s+request_id)?\s*;?\s*$' then
      fixed := regexp_replace(
        j.command,
        '\)(\s*(?:as\s+request_id)?\s*;?\s*)$',
        ', timeout_milliseconds := ' || wait_ms || ')\1',
        'i'
      );
      perform cron.alter_job(job_id := j.jobid, command := fixed);
    else
      raise notice 'cron job % calls a hook with no timeout_milliseconds and was not changed: add one by hand', j.jobname;
    end if;
  end loop;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null; -- no pg_cron here (a fresh local database)
end $$;
