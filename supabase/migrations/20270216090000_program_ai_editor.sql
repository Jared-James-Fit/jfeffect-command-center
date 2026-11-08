-- Edit with AI: the coach's AI program editor (src/lib/program-ai/).
--
-- A coach types what to change about a client's program (or a library
-- template); a background worker reads the athlete and the program, asks the
-- model for structured edit operations, checks them and stores a proposal.
-- Nothing reaches the program until the coach applies it, and applying goes
-- through program_ai_apply / program_ai_apply_template below: one
-- transaction that re-checks who's asking, that every record is still this
-- client's and unchanged since the proposal, that no workout in it has been
-- started or logged, writes a restore point (pl_program_versions) and only
-- then changes the rows. program_ai_restore undoes one, the same way.
-- The model never writes to the database.

-- 1. One turn of an Edit with AI conversation (an instruction and its proposal or answer).
create table if not exists public.program_ai_edits (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid,
  parent_id uuid references public.program_ai_edits(id) on delete set null,
  target_kind text not null check (target_kind in ('client', 'template')),
  client_id uuid references public.clients(id) on delete cascade,
  template_id uuid references public.pl_templates(id) on delete cascade,
  personalize_client_id uuid references public.clients(id) on delete set null,
  focus_block_id uuid references public.pl_blocks(id) on delete set null,
  instruction text not null check (char_length(btrim(instruction)) between 1 and 4000),
  rejected text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'running', 'ready', 'error', 'applied', 'discarded', 'superseded')),
  stage text,
  result jsonb,
  error text,
  model text,
  prompt_version integer,
  attempts integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  applied_changes text[],
  version_id uuid,
  constraint program_ai_edits_target check (
    (target_kind = 'client' and client_id is not null and template_id is null)
    or (target_kind = 'template' and template_id is not null and client_id is null)
  )
);
create index if not exists program_ai_edits_client_idx on public.program_ai_edits (client_id, created_at desc) where client_id is not null;
create index if not exists program_ai_edits_template_idx on public.program_ai_edits (template_id, created_at desc) where template_id is not null;
create index if not exists program_ai_edits_thread_idx on public.program_ai_edits (thread_id, created_at);
create index if not exists program_ai_edits_waiting_idx on public.program_ai_edits (updated_at) where status in ('pending', 'running');

create or replace function public.program_ai_edits_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.thread_id is null then new.thread_id := new.id; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists program_ai_edits_touch on public.program_ai_edits;
create trigger program_ai_edits_touch before insert or update on public.program_ai_edits for each row execute function public.program_ai_edits_touch();

-- 2. Every model call of a turn (what it was sent and what came back), for the coach to inspect.
create table if not exists public.program_ai_edit_calls (
  id uuid primary key default gen_random_uuid(),
  edit_id uuid not null references public.program_ai_edits(id) on delete cascade,
  stage text not null,
  model text not null,
  system_prompt text not null,
  prompt text not null,
  response text,
  prompt_chars integer not null default 0,
  response_chars integer not null default 0,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  ok boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists program_ai_edit_calls_edit_idx on public.program_ai_edit_calls (edit_id, created_at);

-- 3. Rules the AI follows: what the coach set for one athlete (or every athlete).
--    AI observations stay in program_intel_observations (hypotheses until the coach approves them).
create table if not exists public.program_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  kind text not null check (kind in ('hard_constraint', 'coach_preference', 'client_preference', 'temporary_restriction')),
  rule text not null check (char_length(btrim(rule)) between 3 and 500),
  expires_on date,
  active boolean not null default true,
  source text not null default 'coach' check (source in ('coach', 'ai_suggested')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists program_rules_client_idx on public.program_rules (client_id, created_at desc);
drop trigger if exists program_rules_touch on public.program_rules;
create trigger program_rules_touch before update on public.program_rules for each row execute function public.program_intel_touch();

-- 4. Restore points for templates too (and which proposal made them).
alter table public.pl_program_versions alter column client_id drop not null;
alter table public.pl_program_versions add column if not exists template_id uuid references public.pl_templates(id) on delete cascade;
alter table public.pl_program_versions add column if not exists edit_id uuid references public.program_ai_edits(id) on delete set null;
alter table public.pl_program_versions drop constraint if exists pl_program_versions_target;
alter table public.pl_program_versions add constraint pl_program_versions_target check (client_id is not null or template_id is not null);
create index if not exists pl_program_versions_template_idx on public.pl_program_versions (template_id, created_at desc) where template_id is not null;

-- RLS: admins, and a client's own coaches for that client. Templates: admins.
alter table public.program_ai_edits enable row level security;
alter table public.program_ai_edit_calls enable row level security;
alter table public.program_rules enable row level security;
revoke all on public.program_ai_edits, public.program_ai_edit_calls, public.program_rules from anon;
grant select, insert on public.program_ai_edits to authenticated;
grant select on public.program_ai_edit_calls to authenticated;
grant select, insert, update, delete on public.program_rules to authenticated;
grant all on public.program_ai_edits, public.program_ai_edit_calls, public.program_rules to service_role;

drop policy if exists "Coaches read program ai edits" on public.program_ai_edits;
create policy "Coaches read program ai edits" on public.program_ai_edits
  for select to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()));
drop policy if exists "Coaches ask program ai edits" on public.program_ai_edits;
create policy "Coaches ask program ai edits" on public.program_ai_edits
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'pending'
    and result is null
    and applied_at is null
    and (
      (select public.has_role((select auth.uid()), 'admin'::app_role))
      or (target_kind = 'client' and client_id in (select public.coached_client_ids()))
    )
  );

drop policy if exists "Coaches read program ai edit calls" on public.program_ai_edit_calls;
create policy "Coaches read program ai edit calls" on public.program_ai_edit_calls
  for select to authenticated
  using (edit_id in (select e.id from public.program_ai_edits e));

drop policy if exists "Coaches read program rules" on public.program_rules;
create policy "Coaches read program rules" on public.program_rules
  for select to authenticated
  using (
    (select public.has_role((select auth.uid()), 'admin'::app_role))
    or client_id in (select public.coached_client_ids())
    or (client_id is null and (select auth.uid()) in (select co.user_id from public.coaches co where co.archived = false and co.status = 'Active'))
  );
drop policy if exists "Coaches write program rules" on public.program_rules;
create policy "Coaches write program rules" on public.program_rules
  for all to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()))
  with check ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()));

-- Program history: a client's coaches see their client's restore points too.
drop policy if exists "program versions: admins read" on public.pl_program_versions;
drop policy if exists "program versions: coaches read" on public.pl_program_versions;
create policy "program versions: coaches read" on public.pl_program_versions
  for select to authenticated
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()));

-- 5. The background worker: a new turn calls the hook at once; pg_cron every
--    5 minutes picks up anything waiting or cut off.
create or replace function public.program_ai_edits_queue_run()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    begin
      perform net.http_post(
        url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/program-ai-tick',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
        ),
        body := jsonb_build_object('editId', new.id),
        timeout_milliseconds := 300000
      );
    exception when others then
      null; -- never fail the write that queued it; the 5-minute job picks it up
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.program_ai_edits_queue_run() from public, anon, authenticated;
drop trigger if exists program_ai_edits_queue_run on public.program_ai_edits;
create trigger program_ai_edits_queue_run
  after insert or update of status on public.program_ai_edits
  for each row execute function public.program_ai_edits_queue_run();

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'program-ai-tick';
  perform cron.schedule(
    'program-ai-tick',
    '*/5 * * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/program-ai-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    ) as request_id
    where exists (
      select 1 from public.program_ai_edits
      where updated_at > now() - interval '1 day'
        and attempts < 3
        and (status = 'pending' or (status = 'running' and updated_at < now() - interval '6 minutes'))
    );
    $cmd$
  );
exception when others then
  raise notice 'program-ai-tick not scheduled: %', sqlerrm;
end;
$$;

-- 6. Applying a proposal to a client's program, all or nothing.
--    p_plan (built by the server from the proposal and the program as it is now):
--      row_updates  [{id, patch}]            row_inserts [{id, day_id, ...columns}]
--      row_deletes  [{id}]                   day_updates [{id, patch}]
--      day_inserts  [{id, week_id, day_index, title, subtitle, focus}]
--      day_deletes  [{id}]
--      day_bases    [{id, day, rows, rows_max}]  every existing day it touches, as the proposal saw it
--      summary      text
create or replace function public.program_ai_apply(p_edit_id uuid, p_change_ids text[], p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_edit public.program_ai_edits%rowtype;
  v_client uuid;
  v_row_cols text[] := array['exercise_id', 'exercise_name_override', 'sets', 'reps_text', 'rpe', 'rir', 'percentage', 'percentage_basis', 'load_kg', 'load_lb', 'load_unit', 'manual_override', 'rest_seconds', 'rest_seconds_override', 'tempo', 'notes', 'sort_order', 'time_profile', 'purpose_label', 'measurement_type', 'tracking_type', 'duration_seconds'];
  v_touched uuid[];
  v_new_days uuid[];
  v_snapshot jsonb;
  v_version uuid;
  v_bad integer;
  r jsonb;
  v_patch jsonb;
  v_cols text;
  v_rec public.pl_exercise_rows%rowtype;
  v_new public.pl_exercise_rows%rowtype;
  v_counts jsonb;
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then raise exception 'Nothing to apply'; end if;
  select * into v_edit from public.program_ai_edits where id = p_edit_id for update;
  if not found then raise exception 'That proposal was not found'; end if;
  if v_edit.target_kind <> 'client' then raise exception 'That proposal is for a template'; end if;
  v_client := v_edit.client_id;
  if not public.program_intel_can_coach(v_uid, v_client) then
    raise exception 'Only this client''s coach or an admin can change their program' using errcode = '42501';
  end if;
  if v_edit.status = 'applied' then raise exception 'This proposal was already applied' using hint = 'program_ai_applied'; end if;
  if v_edit.status <> 'ready' then raise exception 'This proposal can''t be applied (it''s %)', v_edit.status; end if;
  if exists (select 1 from public.program_ai_edits e where e.thread_id = v_edit.thread_id and e.created_at > v_edit.created_at and e.status in ('pending', 'running', 'ready', 'applied')) then
    raise exception 'There''s a newer version of this proposal' using hint = 'program_ai_stale';
  end if;
  if coalesce(array_length(p_change_ids, 1), 0) = 0 then raise exception 'Pick at least one change'; end if;
  if exists (
    select 1 from unnest(p_change_ids) c
    where not exists (select 1 from jsonb_array_elements(coalesce(v_edit.result -> 'changes', '[]'::jsonb)) ch where ch ->> 'id' = c)
  ) then raise exception 'A picked change isn''t in this proposal'; end if;

  -- Every existing day the plan touches, and the days it makes.
  select coalesce(array_agg(distinct d), '{}') into v_touched from (
    select r2.day_id as d from public.pl_exercise_rows r2
     where r2.id in (select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p_plan -> 'row_updates', '[]'::jsonb) || coalesce(p_plan -> 'row_deletes', '[]'::jsonb)) x)
    union select (x ->> 'day_id')::uuid from jsonb_array_elements(coalesce(p_plan -> 'row_inserts', '[]'::jsonb)) x
    union select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p_plan -> 'day_updates', '[]'::jsonb) || coalesce(p_plan -> 'day_deletes', '[]'::jsonb)) x
  ) s where d is not null;
  select coalesce(array_agg((x ->> 'id')::uuid), '{}') into v_new_days from jsonb_array_elements(coalesce(p_plan -> 'day_inserts', '[]'::jsonb)) x;
  v_touched := array(select unnest(v_touched) except select unnest(v_new_days));
  -- one apply at a time on these workouts (a second one waits, then sees this one's changes)
  perform 1 from public.pl_days where id = any(v_touched) order by id for update;

  -- Rows to change must exist (a removed row is gone: ask again).
  select count(*) into v_bad
    from jsonb_array_elements(coalesce(p_plan -> 'row_updates', '[]'::jsonb) || coalesce(p_plan -> 'row_deletes', '[]'::jsonb)) x
    left join public.pl_exercise_rows r2 on r2.id = (x ->> 'id')::uuid
   where r2.id is null;
  if v_bad > 0 then raise exception 'This program changed since the proposal was made. Ask again so it starts from the latest version.' using hint = 'program_ai_stale'; end if;

  -- Everything it touches is this client's live program.
  select count(*) into v_bad from (
    select d.id, w.id as week_id from public.pl_days d join public.pl_weeks w on w.id = d.week_id where d.id = any(v_touched)
    union all
    select null, (x ->> 'week_id')::uuid from jsonb_array_elements(coalesce(p_plan -> 'day_inserts', '[]'::jsonb)) x
  ) t
  left join public.pl_weeks w2 on w2.id = t.week_id
  left join public.pl_blocks b on b.id = w2.block_id
  where b.id is null or b.client_id is distinct from v_client or b.archived;
  if v_bad > 0 or cardinality(v_touched) <> (select count(*) from public.pl_days where id = any(v_touched)) then
    raise exception 'Part of this proposal isn''t on this client''s current program' using errcode = '42501';
  end if;
  -- Rows can only be added to an existing touched day or a day this plan makes.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_plan -> 'row_inserts', '[]'::jsonb)) x
     where not ((x ->> 'day_id')::uuid = any(v_touched) or (x ->> 'day_id')::uuid = any(v_new_days))
  ) then raise exception 'A new exercise points at a workout outside this proposal'; end if;

  -- Nothing started or logged (a trained workout stays as trained).
  if exists (select 1 from public.pl_day_completions c where c.day_id = any(v_touched) and (c.completed_at is not null or c.started_at is not null or c.in_progress_at is not null or c.training_started_at is not null))
     or exists (select 1 from public.pl_row_results rr join public.pl_exercise_rows r2 on r2.id = rr.row_id where r2.day_id = any(v_touched))
     or exists (select 1 from public.pl_warmup_sets ws join public.pl_exercise_rows r2 on r2.id = ws.row_id where r2.day_id = any(v_touched)) then
    raise exception 'A workout in this proposal has been started or logged since it was made, so it stays as trained. Ask again.' using hint = 'program_ai_locked';
  end if;

  -- Unchanged since the proposal: each touched day, its row count and its latest row edit.
  if exists (
    select 1 from unnest(v_touched) t(id)
     where not exists (select 1 from jsonb_array_elements(coalesce(p_plan -> 'day_bases', '[]'::jsonb)) b where (b ->> 'id')::uuid = t.id)
  ) then raise exception 'The proposal is missing a check for one of its workouts'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_plan -> 'day_bases', '[]'::jsonb)) b
      join public.pl_days d on d.id = (b ->> 'id')::uuid
     where d.updated_at is distinct from (b ->> 'day')::timestamptz
        or (select count(*) from public.pl_exercise_rows r2 where r2.day_id = d.id) <> (b ->> 'rows')::int
        or (select max(r2.updated_at) from public.pl_exercise_rows r2 where r2.day_id = d.id) is distinct from (b ->> 'rows_max')::timestamptz
  ) then raise exception 'This program changed since the proposal was made. Ask again so it starts from the latest version.' using hint = 'program_ai_stale'; end if;

  -- Exercises: from the library only, never an archived one.
  if exists (
    select 1 from (
      select x ->> 'exercise_id' as id from jsonb_array_elements(coalesce(p_plan -> 'row_inserts', '[]'::jsonb)) x
      union all select x -> 'patch' ->> 'exercise_id' from jsonb_array_elements(coalesce(p_plan -> 'row_updates', '[]'::jsonb)) x where x -> 'patch' ? 'exercise_id'
    ) e
    where e.id is null or not exists (select 1 from public.exercises ex where ex.id = e.id::uuid and not ex.archived)
  ) then raise exception 'An exercise in this proposal isn''t in the exercise library'; end if;

  -- The restore point: every touched day as it is now (its rows, warm-ups, calendar entries).
  select jsonb_build_object(
    'v', 2,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', to_jsonb(d),
        'rows', coalesce((select jsonb_agg(to_jsonb(r2) order by r2.sort_order) from public.pl_exercise_rows r2 where r2.day_id = d.id), '[]'::jsonb),
        'scheduled', coalesce((select jsonb_agg(to_jsonb(s)) from public.pl_scheduled_workouts s where s.source_day_id = d.id), '[]'::jsonb),
        'warmup_assignments', coalesce((select jsonb_agg(to_jsonb(wa)) from public.warmup_assignments wa where wa.pl_day_id = d.id), '[]'::jsonb)
      ))
      from public.pl_days d where d.id = any(v_touched)
    ), '[]'::jsonb),
    'created_days', to_jsonb(v_new_days),
    'change_ids', to_jsonb(p_change_ids)
  ) into v_snapshot;
  insert into public.pl_program_versions (client_id, block_id, kind, summary, payload, source, created_by, edit_id)
  values (v_client, v_edit.focus_block_id, 'ai_edit', left(coalesce(nullif(p_plan ->> 'summary', ''), v_edit.instruction), 2000), v_snapshot, 'ai_editor', v_uid, p_edit_id)
  returning id into v_version;

  -- The changes.
  delete from public.pl_exercise_rows where id in (select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p_plan -> 'row_deletes', '[]'::jsonb)) x);
  delete from public.pl_days where id in (select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p_plan -> 'day_deletes', '[]'::jsonb)) x);

  for r in select * from jsonb_array_elements(coalesce(p_plan -> 'day_inserts', '[]'::jsonb)) loop
    insert into public.pl_days (id, week_id, day_index, title, subtitle, focus, is_custom)
    values ((r ->> 'id')::uuid, (r ->> 'week_id')::uuid, (r ->> 'day_index')::int, nullif(btrim(r ->> 'title'), ''), nullif(btrim(r ->> 'subtitle'), ''), nullif(btrim(r ->> 'focus'), ''), false);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_plan -> 'day_updates', '[]'::jsonb)) loop
    v_patch := coalesce(r -> 'patch', '{}'::jsonb);
    update public.pl_days d set
      title = case when v_patch ? 'title' then nullif(btrim(v_patch ->> 'title'), '') else d.title end,
      subtitle = case when v_patch ? 'subtitle' then nullif(btrim(v_patch ->> 'subtitle'), '') else d.subtitle end,
      focus = case when v_patch ? 'focus' then nullif(btrim(v_patch ->> 'focus'), '') else d.focus end,
      day_index = case when v_patch ? 'day_index' then (v_patch ->> 'day_index')::int else d.day_index end
    where d.id = (r ->> 'id')::uuid;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_plan -> 'row_updates', '[]'::jsonb)) loop
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch from jsonb_each(coalesce(r -> 'patch', '{}'::jsonb)) where key = any(v_row_cols);
    select * into v_rec from public.pl_exercise_rows where id = (r ->> 'id')::uuid for update;
    v_new := jsonb_populate_record(v_rec, v_patch);
    update public.pl_exercise_rows set
      exercise_id = v_new.exercise_id, exercise_name_override = v_new.exercise_name_override,
      sets = v_new.sets, reps_text = v_new.reps_text, rpe = v_new.rpe, rir = v_new.rir,
      percentage = v_new.percentage, percentage_basis = v_new.percentage_basis,
      load_kg = v_new.load_kg, load_lb = v_new.load_lb, load_unit = v_new.load_unit, manual_override = v_new.manual_override,
      rest_seconds = v_new.rest_seconds, rest_seconds_override = v_new.rest_seconds_override,
      tempo = v_new.tempo, notes = v_new.notes, sort_order = v_new.sort_order, time_profile = v_new.time_profile,
      purpose_label = v_new.purpose_label, measurement_type = v_new.measurement_type, tracking_type = v_new.tracking_type,
      duration_seconds = v_new.duration_seconds
    where id = v_rec.id;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_plan -> 'row_inserts', '[]'::jsonb)) loop
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch from jsonb_each(r) where key = any(v_row_cols || array['id', 'day_id']);
    select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(v_patch) k;
    execute format('insert into public.pl_exercise_rows (%1$s) select %1$s from jsonb_populate_record(null::public.pl_exercise_rows, $1)', v_cols) using v_patch;
  end loop;

  v_counts := jsonb_build_object(
    'rows_updated', jsonb_array_length(coalesce(p_plan -> 'row_updates', '[]'::jsonb)),
    'rows_added', jsonb_array_length(coalesce(p_plan -> 'row_inserts', '[]'::jsonb)),
    'rows_removed', jsonb_array_length(coalesce(p_plan -> 'row_deletes', '[]'::jsonb)),
    'days_added', jsonb_array_length(coalesce(p_plan -> 'day_inserts', '[]'::jsonb)),
    'days_removed', jsonb_array_length(coalesce(p_plan -> 'day_deletes', '[]'::jsonb)),
    'days_renamed', jsonb_array_length(coalesce(p_plan -> 'day_updates', '[]'::jsonb))
  );
  update public.program_ai_edits
     set status = 'applied', applied_at = now(), applied_by = v_uid, applied_changes = p_change_ids, version_id = v_version
   where id = p_edit_id;
  update public.program_ai_edits set status = 'superseded'
   where thread_id = v_edit.thread_id and id <> p_edit_id and status = 'ready';
  return v_counts || jsonb_build_object('version_id', v_version);
end;
$$;
revoke all on function public.program_ai_apply(uuid, text[], jsonb) from public, anon;
grant execute on function public.program_ai_apply(uuid, text[], jsonb) to authenticated;

-- 7. Applying a proposal to a library template (admins): the new payload, or a
--    new template (a variation). Assigned client programs are copies and never change.
create or replace function public.program_ai_apply_template(p_edit_id uuid, p_change_ids text[], p_payload jsonb, p_base_revision bigint, p_meta jsonb default '{}'::jsonb, p_new_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_edit public.program_ai_edits%rowtype;
  v_tpl public.pl_templates%rowtype;
  v_copy public.pl_templates%rowtype;
  v_version uuid;
  v_target uuid;
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not coalesce(public.has_role(v_uid, 'admin'::app_role), false) then raise exception 'Only an admin can change library templates' using errcode = '42501'; end if;
  select * into v_edit from public.program_ai_edits where id = p_edit_id for update;
  if not found or v_edit.target_kind <> 'template' then raise exception 'That proposal was not found'; end if;
  if v_edit.status = 'applied' then raise exception 'This proposal was already applied' using hint = 'program_ai_applied'; end if;
  if v_edit.status <> 'ready' then raise exception 'This proposal can''t be applied (it''s %)', v_edit.status; end if;
  if exists (select 1 from public.program_ai_edits e where e.thread_id = v_edit.thread_id and e.created_at > v_edit.created_at and e.status in ('pending', 'running', 'ready', 'applied')) then
    raise exception 'There''s a newer version of this proposal' using hint = 'program_ai_stale';
  end if;
  if coalesce(array_length(p_change_ids, 1), 0) = 0 then raise exception 'Pick at least one change'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload -> 'blocks') <> 'array' then raise exception 'The new template isn''t valid'; end if;
  select * into v_tpl from public.pl_templates where id = v_edit.template_id for update;
  if not found then raise exception 'That template was not found'; end if;
  if v_tpl.payload_revision is distinct from p_base_revision then
    raise exception 'This template changed since the proposal was made. Ask again so it starts from the latest version.' using hint = 'program_ai_stale';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload -> 'blocks') b, jsonb_array_elements(coalesce(b -> 'weeks', '[]'::jsonb)) w,
         jsonb_array_elements(coalesce(w -> 'days', '[]'::jsonb)) d, jsonb_array_elements(coalesce(d -> 'rows', '[]'::jsonb)) rw
     where rw ? 'exercise_id' and rw ->> 'exercise_id' is not null
       and not exists (select 1 from public.exercises ex where ex.id::text = rw ->> 'exercise_id')
  ) then raise exception 'An exercise in this proposal isn''t in the exercise library'; end if;

  if p_new_name is not null and btrim(p_new_name) <> '' then
    v_copy := jsonb_populate_record(v_tpl, jsonb_build_object(
      'id', gen_random_uuid(), 'name', left(btrim(p_new_name), 200), 'status', 'Draft', 'payload', p_payload,
      'created_by', v_uid, 'owner_user_id', v_uid, 'archived', false, 'archived_at', null, 'archived_by', null,
      'created_at', now(), 'updated_at', now(), 'payload_revision', 0
    ) || coalesce(p_meta, '{}'::jsonb));
    insert into public.pl_templates select (v_copy).*;
    v_target := v_copy.id;
    insert into public.pl_program_versions (template_id, kind, summary, payload, source, created_by, edit_id)
    values (v_target, 'ai_edit', left('New template "' || btrim(p_new_name) || '" from "' || v_tpl.name || '"', 2000),
            jsonb_build_object('v', 2, 'created_template', v_target, 'from_template', v_tpl.id, 'change_ids', to_jsonb(p_change_ids)), 'ai_editor', v_uid, p_edit_id)
    returning id into v_version;
  else
    v_target := v_tpl.id;
    insert into public.pl_program_versions (template_id, kind, summary, payload, source, created_by, edit_id)
    values (v_target, 'ai_edit', left(v_edit.instruction, 2000),
            jsonb_build_object('v', 2, 'template_before', v_tpl.payload, 'meta_before', jsonb_build_object('weeks', v_tpl.weeks, 'days_per_week', v_tpl.days_per_week), 'change_ids', to_jsonb(p_change_ids)), 'ai_editor', v_uid, p_edit_id)
    returning id into v_version;
    update public.pl_templates set
      payload = p_payload,
      weeks = case when coalesce(p_meta, '{}'::jsonb) ? 'weeks' then (p_meta ->> 'weeks')::int else weeks end,
      days_per_week = case when coalesce(p_meta, '{}'::jsonb) ? 'days_per_week' then (p_meta ->> 'days_per_week')::int else days_per_week end
    where id = v_target;
  end if;
  update public.program_ai_edits
     set status = 'applied', applied_at = now(), applied_by = v_uid, applied_changes = p_change_ids, version_id = v_version
   where id = p_edit_id;
  update public.program_ai_edits set status = 'superseded'
   where thread_id = v_edit.thread_id and id <> p_edit_id and status = 'ready';
  return jsonb_build_object('version_id', v_version, 'template_id', v_target, 'new_template', v_target <> v_tpl.id);
end;
$$;
revoke all on function public.program_ai_apply_template(uuid, text[], jsonb, bigint, jsonb, text) from public, anon;
grant execute on function public.program_ai_apply_template(uuid, text[], jsonb, bigint, jsonb, text) to authenticated;

-- 8. Undo an applied proposal (and the undo itself can be undone). Workouts
--    trained since stay exactly as trained; everything else goes back.
create or replace function public.program_ai_restore(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ver public.pl_program_versions%rowtype;
  v_snap jsonb;
  d jsonb;
  x jsonb;
  v_day uuid;
  v_keep uuid[];
  v_rec public.pl_exercise_rows%rowtype;
  v_new public.pl_exercise_rows%rowtype;
  v_restored int := 0;
  v_skipped int := 0;
  v_removed int := 0;
  v_recreate uuid[] := '{}';
  v_delete uuid[] := '{}';
  v_all uuid[];
  v_locked uuid[];
  v_before jsonb;
  v_new_version uuid;
  v_tpl public.pl_templates%rowtype;
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into v_ver from public.pl_program_versions where id = p_version_id for update;
  if not found then raise exception 'That change wasn''t found in the history'; end if;
  if v_ver.kind <> 'ai_edit' then raise exception 'That change is undone from Cleo''s history'; end if;
  if v_ver.restored_at is not null then raise exception 'That change was already undone'; end if;
  v_snap := coalesce(v_ver.payload, '{}'::jsonb);

  -- Templates
  if v_ver.template_id is not null then
    if not coalesce(public.has_role(v_uid, 'admin'::app_role), false) then raise exception 'Only an admin can change library templates' using errcode = '42501'; end if;
    if v_snap ? 'created_template' then
      update public.pl_templates set archived = true, archived_at = now(), archived_by = v_uid where id = (v_snap ->> 'created_template')::uuid;
      update public.pl_program_versions set restored_at = now(), restored_by = v_uid, restore_note = 'The new template was archived.' where id = p_version_id;
      return jsonb_build_object('note', 'The new template was archived.', 'template_id', v_snap ->> 'created_template');
    end if;
    select * into v_tpl from public.pl_templates where id = v_ver.template_id for update;
    if not found then raise exception 'That template was not found'; end if;
    insert into public.pl_program_versions (template_id, kind, summary, payload, source, created_by)
    values (v_tpl.id, 'ai_edit', left('Before undoing: ' || v_ver.summary, 2000),
            jsonb_build_object('v', 2, 'template_before', v_tpl.payload, 'meta_before', jsonb_build_object('weeks', v_tpl.weeks, 'days_per_week', v_tpl.days_per_week)), 'restore', v_uid)
    returning id into v_new_version;
    update public.pl_templates set
      payload = v_snap -> 'template_before',
      weeks = coalesce((v_snap -> 'meta_before' ->> 'weeks')::int, weeks),
      days_per_week = coalesce((v_snap -> 'meta_before' ->> 'days_per_week')::int, days_per_week)
    where id = v_tpl.id;
    update public.pl_program_versions set restored_at = now(), restored_by = v_uid, restore_note = 'The template is back the way it was.' where id = p_version_id;
    return jsonb_build_object('note', 'The template is back the way it was.', 'template_id', v_tpl.id, 'redo_version_id', v_new_version);
  end if;

  -- Client programs
  if not public.program_intel_can_coach(v_uid, v_ver.client_id) then
    raise exception 'Only this client''s coach or an admin can change their program' using errcode = '42501';
  end if;
  select coalesce(array_agg((e -> 'day' ->> 'id')::uuid), '{}') into v_all from jsonb_array_elements(coalesce(v_snap -> 'days', '[]'::jsonb)) e;
  v_all := v_all || coalesce((select array_agg(value::text::uuid) from jsonb_array_elements_text(coalesce(v_snap -> 'created_days', '[]'::jsonb))), '{}');
  -- trained or started since: left exactly as it is
  perform 1 from public.pl_days where id = any(v_all) order by id for update;
  select coalesce(array_agg(distinct x2), '{}') into v_locked from (
    select c.day_id as x2 from public.pl_day_completions c where c.day_id = any(v_all) and (c.completed_at is not null or c.started_at is not null or c.in_progress_at is not null or c.training_started_at is not null)
    union select r2.day_id from public.pl_row_results rr join public.pl_exercise_rows r2 on r2.id = rr.row_id where r2.day_id = any(v_all)
    union select r2.day_id from public.pl_warmup_sets ws join public.pl_exercise_rows r2 on r2.id = ws.row_id where r2.day_id = any(v_all)
  ) s;

  -- What gets re-made (deleted by the change) and removed (made by it).
  select coalesce(array_agg((e -> 'day' ->> 'id')::uuid), '{}') into v_recreate
    from jsonb_array_elements(coalesce(v_snap -> 'days', '[]'::jsonb)) e
   where not exists (select 1 from public.pl_days dd where dd.id = (e -> 'day' ->> 'id')::uuid)
     and exists (select 1 from public.pl_weeks w where w.id = (e -> 'day' ->> 'week_id')::uuid);
  select coalesce(array_agg(t.id), '{}') into v_delete
    from (select value::text::uuid as id from jsonb_array_elements_text(coalesce(v_snap -> 'created_days', '[]'::jsonb))) t
   where exists (select 1 from public.pl_days dd where dd.id = t.id) and not (t.id = any(v_locked));

  -- So this undo can be undone too: the same days as they are now.
  select jsonb_build_object(
    'v', 2,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', to_jsonb(dd),
        'rows', coalesce((select jsonb_agg(to_jsonb(r2) order by r2.sort_order) from public.pl_exercise_rows r2 where r2.day_id = dd.id), '[]'::jsonb),
        'scheduled', coalesce((select jsonb_agg(to_jsonb(s)) from public.pl_scheduled_workouts s where s.source_day_id = dd.id), '[]'::jsonb),
        'warmup_assignments', coalesce((select jsonb_agg(to_jsonb(wa)) from public.warmup_assignments wa where wa.pl_day_id = dd.id), '[]'::jsonb)
      ))
      from public.pl_days dd where dd.id = any(v_all) and not (dd.id = any(v_locked))
    ), '[]'::jsonb),
    'created_days', to_jsonb(v_recreate),
    'undo_of', p_version_id
  ) into v_before;

  -- Days the change made: gone (unless trained since).
  if cardinality(v_delete) > 0 then
    delete from public.pl_days where id = any(v_delete);
    v_removed := cardinality(v_delete);
  end if;

  for d in select * from jsonb_array_elements(coalesce(v_snap -> 'days', '[]'::jsonb)) loop
    v_day := (d -> 'day' ->> 'id')::uuid;
    if v_day = any(v_locked) then v_skipped := v_skipped + 1; continue; end if;
    if v_day = any(v_recreate) then
      insert into public.pl_days select (jsonb_populate_record(null::public.pl_days, d -> 'day')).*;
    elsif not exists (select 1 from public.pl_days dd where dd.id = v_day) then
      v_skipped := v_skipped + 1; continue;  -- its week is gone
    else
      update public.pl_days dd set
        title = (d -> 'day' ->> 'title'), subtitle = (d -> 'day' ->> 'subtitle'), focus = (d -> 'day' ->> 'focus'),
        day_index = coalesce((d -> 'day' ->> 'day_index')::int, dd.day_index)
      where dd.id = v_day;
    end if;
    select coalesce(array_agg((rw ->> 'id')::uuid), '{}') into v_keep from jsonb_array_elements(coalesce(d -> 'rows', '[]'::jsonb)) rw;
    delete from public.pl_exercise_rows where day_id = v_day and not (id = any(v_keep));
    for x in select * from jsonb_array_elements(coalesce(d -> 'rows', '[]'::jsonb)) loop
      select * into v_rec from public.pl_exercise_rows where id = (x ->> 'id')::uuid;
      if found then
        v_new := jsonb_populate_record(v_rec, x);
        update public.pl_exercise_rows set
          exercise_id = v_new.exercise_id, exercise_name_override = v_new.exercise_name_override,
          sets = v_new.sets, reps_text = v_new.reps_text, rpe = v_new.rpe, rir = v_new.rir,
          percentage = v_new.percentage, percentage_basis = v_new.percentage_basis, basis_row_id = v_new.basis_row_id,
          load_kg = v_new.load_kg, load_lb = v_new.load_lb, load_unit = v_new.load_unit, manual_override = v_new.manual_override,
          rest_seconds = v_new.rest_seconds, rest_seconds_override = v_new.rest_seconds_override,
          tempo = v_new.tempo, notes = v_new.notes, sort_order = v_new.sort_order, time_profile = v_new.time_profile,
          purpose_label = v_new.purpose_label, measurement_type = v_new.measurement_type, tracking_type = v_new.tracking_type,
          duration_seconds = v_new.duration_seconds, intensity_techniques = v_new.intensity_techniques,
          progression_method = v_new.progression_method, cardio_target_id = v_new.cardio_target_id, day_id = v_day
        where id = v_rec.id;
      else
        insert into public.pl_exercise_rows select (jsonb_populate_record(null::public.pl_exercise_rows, x)).*;
      end if;
    end loop;
    for x in select * from jsonb_array_elements(coalesce(d -> 'scheduled', '[]'::jsonb)) loop
      if not exists (select 1 from public.pl_scheduled_workouts s where s.id = (x ->> 'id')::uuid) then
        insert into public.pl_scheduled_workouts select (jsonb_populate_record(null::public.pl_scheduled_workouts, x)).*;
      end if;
    end loop;
    for x in select * from jsonb_array_elements(coalesce(d -> 'warmup_assignments', '[]'::jsonb)) loop
      if not exists (select 1 from public.warmup_assignments wa where wa.id = (x ->> 'id')::uuid) then
        insert into public.warmup_assignments select (jsonb_populate_record(null::public.warmup_assignments, x)).*;
      end if;
    end loop;
    v_restored := v_restored + 1;
  end loop;

  insert into public.pl_program_versions (client_id, block_id, kind, summary, payload, source, created_by)
  values (v_ver.client_id, v_ver.block_id, 'ai_edit', left('Before undoing: ' || v_ver.summary, 2000), v_before, 'restore', v_uid)
  returning id into v_new_version;
  update public.pl_program_versions
     set restored_at = now(), restored_by = v_uid,
         restore_note = format('Put back %s workout%s%s%s.', v_restored, case when v_restored = 1 then '' else 's' end,
                               case when v_removed > 0 then format(', removed %s added', v_removed) else '' end,
                               case when v_skipped > 0 then format(' (%s trained since, left as trained)', v_skipped) else '' end)
   where id = p_version_id;
  return jsonb_build_object('restored', v_restored, 'removed', v_removed, 'skipped', v_skipped, 'redo_version_id', v_new_version,
                            'schedule', v_snap -> 'schedule');
end;
$$;
revoke all on function public.program_ai_restore(uuid) from public, anon;
grant execute on function public.program_ai_restore(uuid) to authenticated;
