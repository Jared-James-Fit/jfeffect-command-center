-- Messenger-native coaching check-ins.
-- Replaces client-facing form navigation for the recurring Weekly Check-In /
-- Nutrition Review with compact in-thread requests and structured coach recaps.

create table if not exists public.messenger_checkins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  occurrence_id uuid null references public.client_task_occurrences(id) on delete set null,
  request_message_id uuid null references public.messages(id) on delete set null,
  task_type text not null check (task_type in ('weekly_checkin','nutrition_review')),
  status text not null default 'pending' check (status in ('pending','completed')),
  answers jsonb not null default '{}'::jsonb,
  context_snapshot jsonb not null default '{}'::jsonb,
  ai_analysis jsonb null,
  ai_status text not null default 'pending' check (ai_status in ('pending','ready','failed')),
  ai_error text null,
  submitted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists messenger_checkins_occurrence_unique
  on public.messenger_checkins(occurrence_id)
  where occurrence_id is not null;

create index if not exists messenger_checkins_client_created_idx
  on public.messenger_checkins(client_id, created_at desc);

alter table public.messenger_checkins enable row level security;

drop policy if exists "Admin manage messenger_checkins" on public.messenger_checkins;
create policy "Admin manage messenger_checkins"
  on public.messenger_checkins for all
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists "Coach manage assigned messenger_checkins" on public.messenger_checkins;
create policy "Coach manage assigned messenger_checkins"
  on public.messenger_checkins for all
  using (public.is_assigned_coach(client_id))
  with check (public.is_assigned_coach(client_id));

drop policy if exists "Client read own messenger_checkins" on public.messenger_checkins;
create policy "Client read own messenger_checkins"
  on public.messenger_checkins for select
  using (
    exists (
      select 1 from public.clients c
      where c.id = messenger_checkins.client_id
        and c.user_id = auth.uid()
    )
  );

-- Client writes go through authenticated server functions so a client cannot
-- alter AI analysis, another client's answers, or task linkage directly.

comment on table public.messenger_checkins is
  'Messenger-native recurring coaching check-ins, answers, app context and coach-facing AI recap.';


-- Retire stale legacy form occurrences so they cannot block the next Messenger
-- cadence. This changes task-reminder state only; historical form submissions
-- and client-entered data are untouched.
update public.client_task_occurrences o
set status = 'skipped',
    updated_at = now(),
    payload_ref = coalesce(o.payload_ref, '{}'::jsonb)
      || jsonb_build_object('skip_reason','migrated_to_messenger_checkin')
where o.task_type in ('weekly_checkin','nutrition_review')
  and o.status not in ('completed','skipped')
  and o.due_local_date <
    ((now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::date);

-- Ensure every non-archived client has a future occurrence even when they have
-- not opened Home recently. Effective per-client overrides still win over the
-- global task definition.
create or replace function public.seed_messenger_checkin_occurrences()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  local_now timestamp;
  local_date date;
  local_clock time;
  due_date date;
  due_at timestamptz;
  target_dow integer;
  delta_days integer;
  month_start date;
  month_end date;
  candidate_15 date;
  candidate_30 date;
  inserted_count integer := 0;
begin
  for r in
    select
      c.id as client_id,
      d.id as definition_id,
      d.task_type,
      d.title,
      coalesce(o.enabled, d.enabled) as enabled,
      coalesce(o.frequency, d.frequency) as frequency,
      coalesce(o.due_day_of_week, d.due_day_of_week) as due_day_of_week,
      coalesce(o.due_time_local, d.due_time_local, '09:00'::time) as due_time_local,
      case coalesce(o.tz_mode, d.tz_mode, 'client')
        when 'fixed' then coalesce(o.fixed_tz, d.fixed_tz, 'UTC')
        when 'coach' then 'UTC'
        else coalesce(nullif(c.timezone,''), 'UTC')
      end as effective_tz,
      o.id as override_id
    from public.clients c
    cross join public.coach_task_definitions d
    left join public.client_task_overrides o
      on o.client_id = c.id
     and o.task_type = d.task_type
    where coalesce(c.archived,false) = false
      and d.task_type in ('weekly_checkin','nutrition_review')
  loop
    if not coalesce(r.enabled,true) then
      continue;
    end if;
    if r.frequency not in ('weekly','semi_monthly') then
      continue;
    end if;
    if exists (
      select 1
      from public.client_task_occurrences x
      where x.client_id = r.client_id
        and x.task_type = r.task_type
        and x.status not in ('completed','skipped')
    ) then
      continue;
    end if;

    local_now := now() at time zone r.effective_tz;
    local_date := local_now::date;
    local_clock := local_now::time;

    if r.frequency = 'weekly' then
      target_dow := coalesce(r.due_day_of_week,6);
      delta_days := (target_dow - extract(dow from local_date)::integer + 7) % 7;
      due_date := local_date + delta_days;
      if delta_days = 0 and local_clock > r.due_time_local then
        due_date := due_date + 7;
      end if;
    else
      month_start := date_trunc('month', local_date)::date;
      month_end := (date_trunc('month', local_date) + interval '1 month - 1 day')::date;
      candidate_15 := month_start + 14;
      candidate_30 := least(month_start + 29, month_end);

      if local_date < candidate_15
         or (local_date = candidate_15 and local_clock <= r.due_time_local) then
        due_date := candidate_15;
      elsif local_date < candidate_30
         or (local_date = candidate_30 and local_clock <= r.due_time_local) then
        due_date := candidate_30;
      else
        month_start := (date_trunc('month', local_date) + interval '1 month')::date;
        due_date := month_start + 14;
      end if;
    end if;

    due_at := (due_date + r.due_time_local) at time zone r.effective_tz;

    insert into public.client_task_occurrences (
      client_id,
      task_type,
      title,
      subtitle,
      due_at_utc,
      due_local_date,
      client_tz,
      status,
      source_definition_id,
      source_override_id,
      priority,
      is_coach_requested,
      metadata
    )
    values (
      r.client_id,
      r.task_type,
      r.title,
      case
        when r.frequency = 'weekly' then 'Weekly · due ' || trim(to_char(due_date,'Day'))
        else '15th + 30th of each month'
      end,
      due_at,
      due_date,
      r.effective_tz,
      'upcoming',
      r.definition_id,
      r.override_id,
      100,
      false,
      '{}'::jsonb
    )
    on conflict do nothing;

    if found then
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  return inserted_count;
end;
$$;

revoke all on function public.seed_messenger_checkin_occurrences() from public, anon, authenticated;

-- Turn due recurring task occurrences into Messenger cards. The unique
-- occurrence index makes retries and overlapping cron ticks idempotent.
create or replace function public.enqueue_due_messenger_checkins()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  occ record;
  new_checkin_id uuid;
  new_message_id uuid;
  sender_user_id uuid;
  created_count integer := 0;
  request_title text;
  request_body text;
begin
  for occ in
    select o.*
    from public.client_task_occurrences o
    where o.task_type in ('weekly_checkin','nutrition_review')
      and o.status not in ('completed','skipped')
      and (
        (
          o.task_type = 'weekly_checkin'
          and o.due_local_date between
            ((now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::date)
            and ((now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::date + 1)
        )
        or
        (
          o.task_type = 'nutrition_review'
          and o.due_local_date =
            ((now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::date)
        )
      )
    order by o.due_at_utc asc
  loop
    new_checkin_id := null;

    insert into public.messenger_checkins (
      client_id, occurrence_id, task_type, status, ai_status
    )
    values (
      occ.client_id, occ.id, occ.task_type, 'pending', 'pending'
    )
    on conflict (occurrence_id) where occurrence_id is not null do nothing
    returning id into new_checkin_id;

    if new_checkin_id is null then
      continue;
    end if;

    select co.user_id
      into sender_user_id
    from public.clients c
    left join public.coaches co on co.id = c.assigned_coach_id
    where c.id = occ.client_id
    limit 1;

    if sender_user_id is null then
      select ur.user_id
        into sender_user_id
      from public.user_roles ur
      where ur.role = 'admin'::public.app_role
      limit 1;
    end if;

    if occ.task_type = 'nutrition_review' then
      request_title := 'Nutrition Review';
      request_body := 'Nutrition review reminder — quick update so I can adjust anything that needs it.';
    else
      request_title := 'Weekly Check-In';
      request_body := 'Weekly check-in reminder — quick update so we can set the right focus for the new week.';
    end if;

    insert into public.messages (
      client_id,
      sender_id,
      sender_role,
      body,
      attachments,
      message_type,
      is_internal_note,
      delivery_status,
      sent_at,
      read_by_admin_at
    )
    values (
      occ.client_id,
      sender_user_id,
      'admin',
      request_body,
      jsonb_build_array(
        jsonb_build_object(
          'type','file',
          'url','',
          'kind','checkin_request',
          'checkin_submission_id',new_checkin_id,
          'checkin_occurrence_id',occ.id,
          'checkin_task_type',occ.task_type,
          'request_title',request_title
        )
      ),
      'Check-In',
      false,
      'sent',
      now(),
      now()
    )
    returning id into new_message_id;

    update public.messenger_checkins
      set request_message_id = new_message_id,
          updated_at = now()
    where id = new_checkin_id;

    created_count := created_count + 1;
  end loop;

  return created_count;
end;
$$;

revoke all on function public.enqueue_due_messenger_checkins() from public, anon, authenticated;

create or replace function public.run_messenger_checkin_automation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  seeded integer;
  enqueued integer;
begin
  seeded := public.seed_messenger_checkin_occurrences();
  enqueued := public.enqueue_due_messenger_checkins();
  return jsonb_build_object('seeded',seeded,'enqueued',enqueued);
end;
$$;

revoke all on function public.run_messenger_checkin_automation() from public, anon, authenticated;

-- Database-native automation: no client page has to be open for the reminder
-- to appear. App-side idempotent bootstrap remains a fallback.
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'messenger-checkin-reminders'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'messenger-checkin-reminders',
    '*/15 * * * *',
    'select public.run_messenger_checkin_automation();'
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;

-- Seed future occurrences immediately. Enqueueing only fires when a task is
-- actually due/tomorrow, so this cannot create a burst of stale reminders.
select public.seed_messenger_checkin_occurrences();
select public.enqueue_due_messenger_checkins();
