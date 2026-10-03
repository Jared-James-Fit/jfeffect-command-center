-- Nutrition Review moves to the LAST FRIDAY of every month; Weekly Check-In
-- keeps its schedule. Reminder copy is shortened (the chat card underneath
-- already carries the title, duration and Start check-in button), and the
-- sender gets explicit duplicate-send guards.

-- ------------------------------------------------------------
-- Date helpers
-- ------------------------------------------------------------

create or replace function public.fn_last_friday_of_month(_d date)
returns date
language sql
immutable
as $$
  select month_end - ((extract(dow from month_end)::int - 5 + 7) % 7)
  from (select (date_trunc('month', _d) + interval '1 month - 1 day')::date as month_end) m;
$$;

-- Next last-Friday on/after (_include_today) or strictly after _from.
create or replace function public.fn_next_last_friday(_from date, _include_today boolean default true)
returns date
language sql
immutable
as $$
  select case
    when public.fn_last_friday_of_month(_from) > _from
      or (_include_today and public.fn_last_friday_of_month(_from) = _from)
      then public.fn_last_friday_of_month(_from)
    else public.fn_last_friday_of_month((date_trunc('month', _from) + interval '1 month')::date)
  end;
$$;

-- ------------------------------------------------------------
-- Schedule: definition + every client override
-- ------------------------------------------------------------

update public.coach_task_definitions
set frequency = 'monthly_last_friday',
    due_day_of_week = null,
    updated_at = now()
where task_type = 'nutrition_review';

-- Apply to every client: drop per-client cadence overrides so they inherit
-- the definition (enabled/time/tz overrides are kept).
update public.client_task_overrides
set frequency = null,
    due_day_of_week = null,
    interval_days = null
where task_type = 'nutrition_review'
  and (frequency is not null or due_day_of_week is not null or interval_days is not null);

-- ------------------------------------------------------------
-- Move open Nutrition Review occurrences onto the new date
-- ------------------------------------------------------------

-- Keep at most one open (not yet sent) occurrence per client.
with ranked as (
  select o.id,
         row_number() over (partition by o.client_id order by o.due_at_utc asc) as rn
  from public.client_task_occurrences o
  where o.task_type = 'nutrition_review'
    and o.status not in ('completed','skipped')
    and not exists (select 1 from public.messenger_checkins mc where mc.occurrence_id = o.id)
)
update public.client_task_occurrences o
set status = 'skipped',
    updated_at = now(),
    payload_ref = coalesce(o.payload_ref, '{}'::jsonb)
      || jsonb_build_object('skip_reason','nutrition_cadence_last_friday_dedupe')
from ranked r
where r.id = o.id and r.rn > 1;

-- Reschedule the remaining one to this month's last Friday (or next month's
-- if this month's has passed), keeping its local due time. Occurrences whose
-- card was already sent are left alone.
update public.client_task_occurrences o
set due_local_date = n.next_date,
    due_at_utc = (n.next_date + n.local_time) at time zone n.tz,
    subtitle = 'Last Friday of each month',
    updated_at = now()
from (
  select x.id,
         coalesce(nullif(x.client_tz,''),'UTC') as tz,
         (x.due_at_utc at time zone coalesce(nullif(x.client_tz,''),'UTC'))::time as local_time,
         public.fn_next_last_friday(
           (now() at time zone coalesce(nullif(x.client_tz,''),'UTC'))::date, true
         ) as next_date
  from public.client_task_occurrences x
  where x.task_type = 'nutrition_review'
    and x.status not in ('completed','skipped')
    and not exists (select 1 from public.messenger_checkins mc where mc.occurrence_id = x.id)
) n
where n.id = o.id
  and o.due_local_date is distinct from n.next_date
  -- Respect client_task_occ_dedupe_active: never collide with another open row.
  and not exists (
    select 1 from public.client_task_occurrences y
    where y.client_id = o.client_id
      and y.task_type = o.task_type
      and y.id <> o.id
      and y.status not in ('completed','skipped')
      and y.due_local_date = n.next_date
  );

-- ------------------------------------------------------------
-- Seeder: understands monthly_last_friday (new + reactivated clients)
-- ------------------------------------------------------------

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
  -- An unsubmitted check-in whose card was already sent and whose due date
  -- has passed must not block the next period forever. Retire it (the card
  -- stays in the chat and can still be submitted) so the next one seeds.
  update public.client_task_occurrences o
  set status = 'skipped',
      updated_at = now(),
      payload_ref = coalesce(o.payload_ref, '{}'::jsonb)
        || jsonb_build_object('skip_reason','superseded_unsubmitted')
  where o.task_type in ('weekly_checkin','nutrition_review')
    and o.status not in ('completed','skipped')
    and o.due_local_date < (now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::date
    and exists (select 1 from public.messenger_checkins mc where mc.occurrence_id = o.id);

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
    if r.frequency not in ('weekly','semi_monthly','monthly_last_friday') then
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
    elsif r.frequency = 'monthly_last_friday' then
      due_date := public.fn_next_last_friday(local_date, local_clock <= r.due_time_local);
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
        when r.frequency = 'monthly_last_friday' then 'Last Friday of each month'
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

-- ------------------------------------------------------------
-- Sender: short copy + duplicate-send guards
-- ------------------------------------------------------------

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
  tz text;
  local_today date;
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
            and ((now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::date + 2)
        )
        or
        (
          o.task_type = 'nutrition_review'
          and o.due_local_date =
            ((now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::date)
          -- Land on Friday morning, not at midnight.
          and (now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::time >= '09:00'::time
        )
      )
    order by o.due_at_utc asc
  loop
    tz := coalesce(nullif(occ.client_tz,''),'UTC');
    local_today := (now() at time zone tz)::date;

    -- Never send a second automated request for the same period: one
    -- Nutrition Review per local calendar month, one Weekly Check-In per
    -- 4 days. Manual coach requests (no occurrence) don't count.
    if exists (
      select 1
      from public.messenger_checkins mc
      where mc.client_id = occ.client_id
        and mc.task_type = occ.task_type
        and mc.occurrence_id is not null
        and mc.occurrence_id <> occ.id
        and (
          (occ.task_type = 'nutrition_review'
            and date_trunc('month', (mc.created_at at time zone tz)) = date_trunc('month', local_today::timestamp))
          or
          (occ.task_type = 'weekly_checkin'
            and (mc.created_at at time zone tz)::date > local_today - 4)
        )
    ) then
      continue;
    end if;

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
      request_body := 'Quick monthly nutrition check-in 👇';
    else
      request_title := 'Weekly Check-In';
      request_body := 'Quick 60-second weekly check-in 👇';
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

-- Seed anyone without an open occurrence. Sending only happens on the due
-- date, so this cannot trigger a burst of reminders today.
select public.seed_messenger_checkin_occurrences();
