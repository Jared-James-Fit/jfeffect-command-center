-- Nutrition Update AI plans are written in the background, never inside the
-- request that asked for one: the client's Submit or the coach's panel / chat
-- only queue the plan (nutrition_ai_plans.status = 'pending'), and the
-- nutrition-plans-tick hook writes it. A plan written inside the caller's
-- request was cut off the moment the phone or tab left the screen, leaving
-- it "generating" forever (David McIntyre's, Oct 27).
--
-- 1. Queuing a plan calls the hook at once (pg_net sends it after commit).
-- 2. pg_cron every 5 minutes calls it again while anything from the last 2
--    days is still waiting or was cut off (generating for 10+ minutes).

create or replace function public.nutrition_ai_plans_queue_run()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending'
     and (tg_op = 'INSERT' or old.status is distinct from 'pending' or old.updated_at is distinct from new.updated_at) then
    begin
      perform net.http_post(
        url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/nutrition-plans-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
        ),
        body := jsonb_build_object('submissionId', new.submission_id),
        timeout_milliseconds := 300000
      );
    exception when others then
      -- Never fail the write that queued it; the 5-minute job picks it up.
      null;
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.nutrition_ai_plans_queue_run() from public, anon, authenticated;

drop trigger if exists nutrition_ai_plans_queue_run on public.nutrition_ai_plans;
create trigger nutrition_ai_plans_queue_run
  after insert or update of status, updated_at on public.nutrition_ai_plans
  for each row execute function public.nutrition_ai_plans_queue_run();

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'nutrition-plans-tick';
  perform cron.schedule(
    'nutrition-plans-tick',
    '*/5 * * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/nutrition-plans-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    ) as request_id
    where exists (
      select 1 from public.nutrition_ai_plans
      where updated_at > now() - interval '2 days'
        and (status = 'pending' or (status = 'generating' and updated_at < now() - interval '10 minutes'))
    );
    $cmd$
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;
