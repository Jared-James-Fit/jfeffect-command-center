-- Saturday Spirit gets a real picture: every 3 hours the post-pictures-tick
-- hook makes one (an image model, src/lib/post-pictures.server.ts) for a
-- Saturday post that went out without one, else for Saturday's next library
-- post, which then goes out with it like a photo the coach added. One picture
-- per run; a failed try waits 6 hours (app_settings.post_pictures_status).
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'post-pictures-tick';
  perform cron.schedule(
    'post-pictures-tick',
    '23 */3 * * *',
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
