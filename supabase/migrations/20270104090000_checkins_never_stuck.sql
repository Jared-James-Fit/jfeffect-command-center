-- A weekly check-in (or nutrition review) that was never sent no longer
-- blocks every one after it.
--
-- The seed only adds a client's next check-in when they have no open one, and
-- its clean-up only closed overdue rows that had been sent (a
-- messenger_checkins row). A row that was never sent (Nicole's: made for the
-- week she'd just done after her timezone moved from Winnipeg to Edmonton, so
-- the send skipped it as "already had one this week") stayed open forever and
-- she got no check-in from Oct 11 on. Overdue rows that were never sent are
-- now closed too (skip_reason 'missed_never_sent'), and the seed never makes a
-- row on or before the last one done or skipped for that task.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.seed_messenger_checkin_occurrences()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  last_done date;
  inserted_count integer := 0;
begin
  -- Past due and still open: the next one replaces it, sent or not.
  update public.client_task_occurrences o
  set status = 'skipped',
      updated_at = now(),
      payload_ref = coalesce(o.payload_ref, '{}'::jsonb)
        || jsonb_build_object(
             'skip_reason',
             case when exists (select 1 from public.messenger_checkins mc where mc.occurrence_id = o.id)
                  then 'superseded_unsubmitted' else 'missed_never_sent' end)
  where o.task_type in ('weekly_checkin','nutrition_review')
    and o.status not in ('completed','skipped')
    and o.due_local_date < (now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::date;

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
      and c.service_tier = 'coaching'
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

    -- Never again for a period already done or skipped (one finished early,
    -- or a coach's skip of this week).
    select max(x.due_local_date) into last_done
      from public.client_task_occurrences x
     where x.client_id = r.client_id
       and x.task_type = r.task_type
       and x.status in ('completed','skipped');
    if last_done is not null and due_date <= last_done then
      if r.frequency = 'weekly' then
        due_date := due_date + 7 * ((last_done - due_date) / 7 + 1);
      else
        continue; -- picked up once that date has passed
      end if;
    end if;

    due_at := (due_date + r.due_time_local) at time zone r.effective_tz;

    insert into public.client_task_occurrences (
      client_id, task_type, title, subtitle, due_at_utc, due_local_date, client_tz,
      status, source_definition_id, source_override_id, priority, is_coach_requested, metadata
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
$function$;
