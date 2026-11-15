-- Missing program data, the coach's morning push (Nov 15 2026): once a day at
-- 8:07 in Winnipeg (13:07 UTC: Manitoba is a fixed UTC-5 from Nov 1, 2026),
-- program-gaps-tick reads every coaching client's gaps (program_gaps(), as
-- the server) and pushes the coach `program_gaps_due` for each client with a
-- gap on a workout in the next 3 days, at most once a client a day
-- (program-gaps.server.ts). The Messages filter, the Brief and the Training
-- tab show the rest whenever the coach looks; this is for the one that's
-- about to reach the client.

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'program-gaps-tick';
  perform cron.schedule(
    'program-gaps-tick',
    '7 13 * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/program-gaps-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    ) as request_id;
    $cmd$
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;
