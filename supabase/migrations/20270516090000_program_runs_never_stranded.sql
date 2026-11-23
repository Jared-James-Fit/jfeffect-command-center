-- Generate Next Program runs are never stranded for long (Nov 23 2026).
--
-- A run's worker request can be cut off by the host mid-poll (Cloudflare 1102 / 502). The run
-- stays "running" until it looks abandoned; that was 10 minutes, checked every 5, so Dwayne's
-- strategy sat idle 10–15 minutes twice in one run. A Generate Next Program request hands back
-- within about a minute, so the worker now treats one untouched for 2 minutes (a model stage; 5 for the code-only ones) as cut off
-- (jobs.server.ts staleAfter; interpret runs and benchmarks keep 10), and this job looks
-- every minute while one is waiting or looks abandoned. A run cut off at its last attempt is now
-- stopped with Try again by the worker (stopStuckRuns), so those are included here too.
-- Nothing is sent while no run is waiting.

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'program-intel-tick';
  perform cron.schedule(
    'program-intel-tick',
    '* * * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/program-intel-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    ) as request_id
    where exists (
      select 1 from public.program_intel_jobs
      where updated_at > now() - interval '2 days'
        and ((status = 'pending' and attempts < 3)
          or (status = 'running' and updated_at < now() - interval '2 minutes'))
    );
    $cmd$
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;
