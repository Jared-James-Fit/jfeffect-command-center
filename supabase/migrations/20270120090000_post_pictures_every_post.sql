-- Every automated post goes out as a real photo (not just Saturday's), so the
-- post-pictures-tick hook (src/lib/post-pictures.server.ts) runs every 30
-- minutes instead of every 3 hours: a post the app writes on the day (Wins,
-- the Recap, Tuesday's numbers, a lesson, a holiday, a birthday) gets its
-- photo within about half an hour, each day's next library post gets one
-- ahead of time, and older posts are caught up. Still one picture per run;
-- a failed try waits 2 hours.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'post-pictures-tick';
  perform cron.schedule(
    'post-pictures-tick',
    '7,37 * * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/post-pictures-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    ) as request_id;
    $cmd$
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;
