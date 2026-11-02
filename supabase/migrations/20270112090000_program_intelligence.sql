-- Program Intelligence: a coach's report on a client's training (computed in
-- the app from the client's own records), the athlete's memory across
-- programs, the AI runs that interpret a report or draft the next program,
-- and an audit trail of every export. Coaches of the client and admins only:
-- clients, members and the finance login have no access to any of it.

-- Who may coach a client, for the background worker (no signed-in user there):
-- an admin, or the client's active assigned coach.
create or replace function public.program_intel_can_coach(_user uuid, _client uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.has_role(_user, 'admin'::app_role), false)
    or exists (
      select 1
        from public.clients c
        join public.coaches co on co.id = c.assigned_coach_id
       where c.id = _client
         and co.user_id = _user
         and co.archived = false
         and co.status = 'Active'
    )
$$;
revoke all on function public.program_intel_can_coach(uuid, uuid) from public, anon, authenticated;
grant execute on function public.program_intel_can_coach(uuid, uuid) to service_role;

-- 1. The athlete's memory: observations (from a report, the AI or the coach),
--    programming decisions, and what came of them. Nothing is treated as
--    proven until the coach approves (or corrects) it.
create table if not exists public.program_intel_observations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null default 'observation' check (kind in ('observation', 'decision', 'outcome')),
  category text check (category is null or char_length(category) <= 60),
  statement text not null check (char_length(btrim(statement)) between 1 and 1000),
  corrected_statement text check (corrected_statement is null or char_length(corrected_statement) <= 1000),
  confidence text not null default 'hypothesis' check (confidence in ('fact', 'hypothesis')),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'corrected', 'rejected')),
  source text not null default 'analysis' check (source in ('analysis', 'ai', 'coach')),
  evidence jsonb not null default '[]'::jsonb,
  finding_key text check (finding_key is null or char_length(finding_key) <= 200),
  block_id uuid references public.pl_blocks(id) on delete set null,
  decision_id uuid references public.program_intel_observations(id) on delete set null,
  job_id uuid,
  data_hash text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  -- a hypothesis can't be stored as a proven response without a coach saying so
  constraint program_intel_obs_ai_unproven check (source <> 'ai' or confidence = 'hypothesis' or status in ('approved', 'corrected'))
);
create index if not exists program_intel_observations_client_idx on public.program_intel_observations (client_id, created_at desc);
create index if not exists program_intel_observations_block_idx on public.program_intel_observations (block_id) where block_id is not null;

-- 2. The coaching brain a coach picked for a client (null = read from the data).
create table if not exists public.program_intel_profiles (
  client_id uuid primary key references public.clients(id) on delete cascade,
  brain_override text check (brain_override is null or brain_override in ('powerlifting', 'bodybuilding', 'powerbuilding', 'general_fitness')),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 3. AI runs: interpret a report (proposed observations) or draft the next
--    program (a hidden draft block the coach previews, edits and assigns).
--    Written in the background by the program-intel-tick hook.
create table if not exists public.program_intel_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('interpret', 'generate')),
  status text not null default 'pending' check (status in ('pending', 'running', 'ready', 'error', 'discarded', 'assigned')),
  scope jsonb not null,
  brain text not null check (brain in ('powerlifting', 'bodybuilding', 'powerbuilding', 'general_fitness')),
  instructions text check (instructions is null or char_length(instructions) <= 2000),
  options jsonb not null default '{}'::jsonb,
  privacy_safe boolean not null default false,
  data_hash text,
  model text,
  prompt_version integer,
  result jsonb,
  block_id uuid references public.pl_blocks(id) on delete set null,
  error text,
  attempts integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists program_intel_jobs_client_idx on public.program_intel_jobs (client_id, created_at desc);
create index if not exists program_intel_jobs_waiting_idx on public.program_intel_jobs (updated_at) where status in ('pending', 'running');

-- 4. Every export / copy, so a report can be traced (who, when, which records).
create table if not exists public.program_intel_exports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  action text not null check (action in ('copy_prompt', 'download_pdf', 'download_markdown', 'download_json', 'download_csv')),
  privacy_safe boolean not null default false,
  scope jsonb,
  brain text,
  data_hash text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists program_intel_exports_client_idx on public.program_intel_exports (client_id, created_at desc);

-- updated_at
create or replace function public.program_intel_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists program_intel_observations_touch on public.program_intel_observations;
create trigger program_intel_observations_touch before update on public.program_intel_observations for each row execute function public.program_intel_touch();
drop trigger if exists program_intel_profiles_touch on public.program_intel_profiles;
create trigger program_intel_profiles_touch before update on public.program_intel_profiles for each row execute function public.program_intel_touch();
drop trigger if exists program_intel_jobs_touch on public.program_intel_jobs;
create trigger program_intel_jobs_touch before update on public.program_intel_jobs for each row execute function public.program_intel_touch();

-- RLS: admins and the client's coaches only (checked once per query).
alter table public.program_intel_observations enable row level security;
alter table public.program_intel_profiles enable row level security;
alter table public.program_intel_jobs enable row level security;
alter table public.program_intel_exports enable row level security;
revoke all on public.program_intel_observations, public.program_intel_profiles, public.program_intel_jobs, public.program_intel_exports from anon;

drop policy if exists "Coaches manage program intel observations" on public.program_intel_observations;
create policy "Coaches manage program intel observations" on public.program_intel_observations
  for all to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()))
  with check ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()));

drop policy if exists "Coaches manage program intel profiles" on public.program_intel_profiles;
create policy "Coaches manage program intel profiles" on public.program_intel_profiles
  for all to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()))
  with check ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()));

drop policy if exists "Coaches read program intel jobs" on public.program_intel_jobs;
create policy "Coaches read program intel jobs" on public.program_intel_jobs
  for select to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()));
drop policy if exists "Coaches queue program intel jobs" on public.program_intel_jobs;
create policy "Coaches queue program intel jobs" on public.program_intel_jobs
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'pending'
    and block_id is null
    and ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()))
  );
drop policy if exists "Coaches close program intel jobs" on public.program_intel_jobs;
create policy "Coaches close program intel jobs" on public.program_intel_jobs
  for update to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()))
  with check ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()));

drop policy if exists "Coaches read program intel exports" on public.program_intel_exports;
create policy "Coaches read program intel exports" on public.program_intel_exports
  for select to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()));
drop policy if exists "Coaches log program intel exports" on public.program_intel_exports;
create policy "Coaches log program intel exports" on public.program_intel_exports
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()))
  );

grant select, insert, update, delete on public.program_intel_observations to authenticated;
grant select, insert, update, delete on public.program_intel_profiles to authenticated;
grant select, insert, update on public.program_intel_jobs to authenticated;
grant select, insert on public.program_intel_exports to authenticated;

-- A coach can only move a job to "discarded" or "assigned" (the worker, as the
-- service role, owns pending → running → ready / error and what's written).
create or replace function public.program_intel_jobs_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if new.client_id is distinct from old.client_id or new.kind is distinct from old.kind
     or new.created_by is distinct from old.created_by or new.result is distinct from old.result
     or new.block_id is distinct from old.block_id or new.scope is distinct from old.scope then
    raise exception 'Only the status of a Program Intelligence run can change';
  end if;
  if new.status is distinct from old.status and new.status not in ('discarded', 'assigned', 'pending') then
    raise exception 'A run can only be discarded, assigned or retried';
  end if;
  if new.status = 'pending' and old.status <> 'error' then
    raise exception 'Only a failed run can be retried';
  end if;
  return new;
end;
$$;
drop trigger if exists program_intel_jobs_guard on public.program_intel_jobs;
create trigger program_intel_jobs_guard before update on public.program_intel_jobs for each row execute function public.program_intel_jobs_guard();

-- The background worker: queuing (or retrying) a job calls the hook at once;
-- pg_cron every 5 minutes picks up anything waiting or cut off.
create or replace function public.program_intel_jobs_queue_run()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    begin
      perform net.http_post(
        url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/program-intel-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
        ),
        body := jsonb_build_object('jobId', new.id),
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
revoke all on function public.program_intel_jobs_queue_run() from public, anon, authenticated;
drop trigger if exists program_intel_jobs_queue_run on public.program_intel_jobs;
create trigger program_intel_jobs_queue_run
  after insert or update of status on public.program_intel_jobs
  for each row execute function public.program_intel_jobs_queue_run();

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'program-intel-tick';
  perform cron.schedule(
    'program-intel-tick',
    '*/5 * * * *',
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
        and attempts < 3
        and (status = 'pending' or (status = 'running' and updated_at < now() - interval '10 minutes'))
    );
    $cmd$
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;

SELECT public.rls_evaluate_once('program_intel_observations');
SELECT public.rls_evaluate_once('program_intel_profiles');
SELECT public.rls_evaluate_once('program_intel_jobs');
SELECT public.rls_evaluate_once('program_intel_exports');
