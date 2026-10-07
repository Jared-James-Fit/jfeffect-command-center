-- Fix: scheduled app hooks were silently rejected (HTTP 401) since the hooks
-- started requiring the worker secret.
--
-- The cron jobs only sent the public anon `apikey`, the hooks check
-- `x-worker-secret`, so every scheduled call to appointment reminders, birthday /
-- daily pushes, the unread-message texts, nutrition tick, signup cleanup, media
-- archive and lift archive returned 401. pg_cron still logged "succeeded"
-- because that only records that the request was queued.
--
-- The hooks now also accept `x-hook-secret` (src/lib/hook-auth.server.ts): a
-- random secret generated here, kept in Vault, read by the cron job itself and
-- by the hook through cron_hook_secret(). It cannot drift from an env var, and
-- the public anon key is deliberately not accepted.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_hook_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'cron_hook_secret',
      'Auth for pg_cron calls to /api/public/hooks/*'
    );
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end
$$;

create or replace function public.cron_hook_secret()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1;
$$;

revoke all on function public.cron_hook_secret() from public, anon, authenticated;
grant execute on function public.cron_hook_secret() to service_role;

-- Quick diagnosis: HTTP status of the scheduled calls over the last N minutes.
-- Anything other than 200 here means a scheduled hook is failing even though
-- cron.job_run_details says "succeeded". (pg_net keeps roughly 6 hours.)
create or replace function public.cron_http_health(p_minutes integer default 60)
returns table (status_code integer, calls bigint, last_seen timestamptz)
language sql
security definer
set search_path = public
as $$
  select r.status_code, count(*), max(r.created)
  from net._http_response r
  where r.created > now() - make_interval(mins => p_minutes)
  group by r.status_code
  order by r.status_code;
$$;

revoke all on function public.cron_http_health(integer) from public, anon, authenticated;

-- Re-point every scheduled hook at the new header. Idempotent.
--  * unread-message texts: every 10 minutes (was every minute; the steps are
--    24h/48h so minute-level polling bought nothing)
--  * lift archive: one job (it was scheduled twice every 2 minutes, which could
--    race on the same video)
do $$
declare
  j record;
  base text := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/';
begin
  for j in
    select * from (values
      ('appointment-reminders-tick',       '*/5 * * * *',  'appointment-reminders'),
      ('birthday-notifications-hourly',    '5 * * * *',    'birthday-notifications'),
      ('jf-cleanup-pending-signups-hourly','0 * * * *',    'cleanup-pending-signups'),
      ('lift-archive-tick-2m',             '*/2 * * * *',  'lift-archive-tick'),
      ('media-archive-nightly',            '15 3 * * *',   'media-archive'),
      ('nutrition-status-tick',            '0 8 * * *',    'nutrition-tick'),
      ('sms-unread-reminders',             '*/10 * * * *', 'sms-reminders')
    ) as t(jobname, schedule, hook)
  loop
    perform cron.unschedule(jobid) from cron.job where jobname = j.jobname;
    perform cron.schedule(
      j.jobname,
      j.schedule,
      format(
        $cmd$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
          ),
          body := '{}'::jsonb
        ) as request_id;
        $cmd$,
        base || j.hook
      )
    );
  end loop;

  -- The duplicate lift archive job.
  perform cron.unschedule(jobid) from cron.job where jobname = 'lift-archive-tick';
exception
  when undefined_table or undefined_function then
    null;
end
$$;
