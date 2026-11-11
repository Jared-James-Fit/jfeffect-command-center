-- "Change it with AI" on the coach's Current plan card: the coach types what
-- to change about a client's current nutrition plan, the AI writes it in the
-- background (the same writer and hook as the Nutrition Update AI,
-- nutrition-plans-tick), and the coach reviews what changes day by day before
-- anything reaches the client. Applying updates the plan in place (like Edit
-- this plan) and keeps its days from before, so the change can be undone.
--
-- Written only by the server (service role) after a staff check; staff read
-- (admins, and a coach for the clients they coach). Clients never see it: the
-- coach's instructions stay the coach's.

create table if not exists public.nutrition_plan_edits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  target_id uuid not null references public.nutrition_targets(id) on delete cascade,
  instructions text not null check (char_length(instructions) between 1 and 2000),
  status text not null default 'pending'
    check (status in ('pending', 'generating', 'ready', 'error', 'applied', 'discarded', 'undone')),
  -- The plan as the AI read it (planAsTargetsText / planAsMealPlanText). Apply
  -- refuses when the plan no longer reads the same: it changed since.
  before_targets_text text not null,
  before_meal_plan_text text not null,
  -- The AI's answer.
  targets_text text,
  meal_plan_text text,
  -- The OpenAI background call(s) in flight (staged-call.server.ts); null when none.
  progress jsonb,
  model text,
  error text,
  -- The plan's days and weighing rules as they were when the change was applied, for Undo.
  restore jsonb,
  created_by uuid,
  applied_at timestamptz,
  applied_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nutrition_plan_edits_target_idx
  on public.nutrition_plan_edits (target_id, created_at desc);
create index if not exists nutrition_plan_edits_waiting_idx
  on public.nutrition_plan_edits (updated_at)
  where status in ('pending', 'generating');

alter table public.nutrition_plan_edits enable row level security;

drop policy if exists "Staff read nutrition plan edits" on public.nutrition_plan_edits;
create policy "Staff read nutrition plan edits" on public.nutrition_plan_edits
  for select to authenticated
  using (
    (select public.has_role((select auth.uid()), 'admin'::app_role))
    or client_id in (select public.coached_client_ids())
  );

revoke insert, update, delete on public.nutrition_plan_edits from anon, authenticated;

-- Queuing a change calls the writer at once (pg_net sends it after commit).
create or replace function public.nutrition_plan_edits_queue_run()
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
        body := jsonb_build_object('editId', new.id),
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

revoke all on function public.nutrition_plan_edits_queue_run() from public, anon, authenticated;

drop trigger if exists nutrition_plan_edits_queue_run on public.nutrition_plan_edits;
create trigger nutrition_plan_edits_queue_run
  after insert or update of status, updated_at on public.nutrition_plan_edits
  for each row execute function public.nutrition_plan_edits_queue_run();

-- The 5-minute catch-up also wakes the writer for a change still waiting or cut off.
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
    )
    or exists (
      select 1 from public.nutrition_plan_edits
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

select public.rls_evaluate_once('nutrition_plan_edits');
