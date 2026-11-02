-- Generate Next Program, rebuilt as a staged pipeline:
--   - seven programming frameworks (brains) instead of four;
--   - a "strategy" run (the programming strategy the coach approves before a
--     program is built) beside "interpret" and "generate";
--   - each run keeps its stage, its progress for the coach's screen, and a
--     snapshot of exactly what it used (setup, conflicts, data quality, the
--     brief the model read and its size, the model configuration);
--   - every model call is logged with its exact prompt and reply
--     (program_intel_job_calls), readable by the client's coaches for the
--     context inspector and written only by the background worker;
--   - the coach's confirmed equipment profile per client.

alter table public.program_intel_profiles drop constraint if exists program_intel_profiles_brain_override_check;
alter table public.program_intel_profiles add constraint program_intel_profiles_brain_override_check
  check (brain_override is null or brain_override in ('powerlifting', 'bodybuilding', 'powerbuilding', 'general_strength', 'general_fitness', 'hybrid', 'other'));
alter table public.program_intel_profiles add column if not exists equipment_profile jsonb;
alter table public.program_intel_profiles drop constraint if exists program_intel_profiles_equipment_profile_check;
alter table public.program_intel_profiles add constraint program_intel_profiles_equipment_profile_check
  check (equipment_profile is null or (jsonb_typeof(equipment_profile) = 'object' and pg_column_size(equipment_profile) < 20000));

alter table public.program_intel_jobs drop constraint if exists program_intel_jobs_brain_check;
alter table public.program_intel_jobs add constraint program_intel_jobs_brain_check
  check (brain in ('powerlifting', 'bodybuilding', 'powerbuilding', 'general_strength', 'general_fitness', 'hybrid', 'other'));
alter table public.program_intel_jobs drop constraint if exists program_intel_jobs_kind_check;
alter table public.program_intel_jobs add constraint program_intel_jobs_kind_check
  check (kind in ('interpret', 'strategy', 'generate'));
alter table public.program_intel_jobs add column if not exists stage text;
alter table public.program_intel_jobs add column if not exists progress jsonb;
alter table public.program_intel_jobs add column if not exists context jsonb;
alter table public.program_intel_jobs add column if not exists strategy_job_id uuid references public.program_intel_jobs(id) on delete set null;

-- A queued run starts clean: no stage, progress, context or result of its own.
drop policy if exists "Coaches queue program intel jobs" on public.program_intel_jobs;
create policy "Coaches queue program intel jobs" on public.program_intel_jobs
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'pending'
    and block_id is null
    and stage is null
    and progress is null
    and context is null
    and result is null
    and ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()))
  );

-- Every model call a run made: exact prompt, reply, model, size and timing.
create table if not exists public.program_intel_job_calls (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.program_intel_jobs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  stage text not null,
  model text not null,
  system_prompt text not null,
  prompt text not null,
  response text,
  prompt_chars integer not null default 0,
  response_chars integer not null default 0,
  est_input_tokens integer,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  ok boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists program_intel_job_calls_job_idx on public.program_intel_job_calls (job_id, created_at);
create index if not exists program_intel_job_calls_client_idx on public.program_intel_job_calls (client_id, created_at desc);

alter table public.program_intel_job_calls enable row level security;
revoke all on public.program_intel_job_calls from anon;
drop policy if exists "Coaches read program intel job calls" on public.program_intel_job_calls;
create policy "Coaches read program intel job calls" on public.program_intel_job_calls
  for select to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()));
grant select on public.program_intel_job_calls to authenticated;

-- A coach only moves a run's status (discard, assign, retry a failed one);
-- the worker (service role) owns its stage, progress, context and result.
create or replace function public.program_intel_jobs_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if new.client_id is distinct from old.client_id or new.kind is distinct from old.kind
     or new.created_by is distinct from old.created_by or new.result is distinct from old.result
     or new.block_id is distinct from old.block_id or new.scope is distinct from old.scope
     or new.stage is distinct from old.stage or new.progress is distinct from old.progress
     or new.context is distinct from old.context or new.options is distinct from old.options
     or new.brain is distinct from old.brain or new.model is distinct from old.model
     or new.data_hash is distinct from old.data_hash then
    raise exception 'Only the status of a Program Intelligence run can change';
  end if;
  if new.status is distinct from old.status and new.status not in ('discarded', 'assigned', 'pending') then
    raise exception 'A run can only be discarded, assigned or retried';
  end if;
  if new.status = 'pending' and old.status <> 'error' then
    raise exception 'Only a failed run can be retried';
  end if;
  if new.attempts is distinct from old.attempts and not (new.status = 'pending' and old.status = 'error' and new.attempts = 0) then
    raise exception 'Only a retry resets the attempts';
  end if;
  return new;
end;
$$;

SELECT public.rls_evaluate_once('program_intel_job_calls');
SELECT public.rls_evaluate_once('program_intel_jobs');
