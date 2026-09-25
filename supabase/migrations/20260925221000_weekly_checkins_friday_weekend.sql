-- Weekly coaching check-ins: deliver Friday, due Sunday night.
-- This gives clients the full weekend to submit while keeping the recurring
-- task due date aligned to the end of the weekend.

update public.coach_task_definitions
set due_day_of_week = 0,
    due_time_local = '23:59:00'::time,
    updated_at = now()
where task_type = 'weekly_checkin';

-- Retire stale active weekly occurrences so they cannot block the current week.
update public.client_task_occurrences o
set status = 'skipped',
    updated_at = now(),
    payload_ref = coalesce(o.payload_ref, '{}'::jsonb)
      || jsonb_build_object('skip_reason','weekly_cadence_reset_to_friday')
where o.task_type = 'weekly_checkin'
  and o.status not in ('completed','skipped')
  and o.due_local_date <
    ((now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::date);

-- Existing Saturday occurrences for this/current future week become Sunday
-- occurrences, preserving the exact local due time by shifting UTC +1 day.
update public.client_task_occurrences o
set due_local_date = o.due_local_date + 1,
    due_at_utc = o.due_at_utc + interval '1 day',
    subtitle = 'Weekly · due Sunday',
    updated_at = now()
where o.task_type = 'weekly_checkin'
  and o.status not in ('completed','skipped')
  and extract(dow from o.due_local_date) = 6
  and o.due_local_date >=
    ((now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::date);

-- Friday delivery = Sunday due date within the next 2 local calendar days.
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
            and ((now() at time zone coalesce(nullif(o.client_tz,''),'UTC'))::date + 2)
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

-- Re-seed clients that were blocked by stale occurrences, then send every
-- currently-due Friday request immediately. Both functions are idempotent.
select public.seed_messenger_checkin_occurrences();
select public.enqueue_due_messenger_checkins();
