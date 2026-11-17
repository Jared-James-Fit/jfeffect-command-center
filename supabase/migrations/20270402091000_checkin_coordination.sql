-- One client, one coordinated check-in (src/lib/checkin-coordination/plan.ts).
--
-- The weekly check-in is the only recurring form. What else a week needs
-- (weight-making questions near a meet, progress photos and the tape when
-- they're due, a weigh-in only when none was logged) rides on it as a step,
-- worked out once and kept on the check-in (messenger_checkins.plan) with why.
--
-- Delivery, coordinated:
-- 1. The weekly card lands at 7am in the client's own time (it went out at
--    the first tick after midnight), before the 8am digest that is its one
--    reminder (the unread nudge now leaves automated cards to the digest).
-- 2. Any weekly check-in counts toward the 4-day guard, a coach's by hand
--    included: a check-in sent Thursday means Friday's automated one doesn't
--    go (submitting it completes that week, messenger-checkins.functions.ts).
-- 3. Archived, deactivated and non-coaching clients never get the automated
--    card (the sender only looked at the occurrence).
-- 4. The monthly Nutrition Update goes out the same morning as that month's
--    last weekly check-in (the last 7 days of the month), so it's one
--    delivery and one digest, not a Monday form and a Friday form; a client
--    with no weekly check-in in that window keeps the last-Monday rule. A plan
--    marked "not needed" is left alone (cadence is "manual" on every plan by
--    default, so it isn't read as a choice).
-- 5. Both senders take an advisory lock, so overlapping runs can't double-send.
-- The clocks go through instant_to_local (Manitoba is UTC-5 from Nov 1 2026).

ALTER TABLE public.messenger_checkins ADD COLUMN IF NOT EXISTS plan jsonb;

-- 6. The Nutrition Update's bodyweight question fills itself from a weigh-in logged today or
--    yesterday (form-prefill.ts "bodyweight"), so a client who logs daily isn't asked twice;
--    they can still change it, and an older weigh-in leaves it for them to answer.
UPDATE public.nf_questions
   SET validation = coalesce(validation, '{}'::jsonb) || '{"prefill":"bodyweight"}'::jsonb
 WHERE form_id = 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d'
   AND label ILIKE 'Current fasted bodyweight%'
   AND NOT (coalesce(validation, '{}'::jsonb) ? 'prefill');

-- ---------------------------------------------------------------------------

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
  local_now timestamp;
  local_today date;
begin
  -- one run at a time: an overlapping tick never sends a second card
  if not pg_try_advisory_xact_lock(hashtext('enqueue_due_messenger_checkins')) then
    return 0;
  end if;

  for occ in
    select o.*
    from public.client_task_occurrences o
    join public.clients c on c.id = o.client_id
    where o.task_type in ('weekly_checkin','nutrition_review')
      and o.status not in ('completed','skipped')
      and coalesce(c.archived, false) = false
      and c.service_tier = 'coaching'
      and coalesce(c.status, '') not in ('Deactivated', 'Deleted')
    order by o.due_at_utc asc
  loop
    tz := coalesce(nullif(occ.client_tz,''),'UTC');
    begin
      local_now := public.instant_to_local(now(), tz);
    exception when others then
      tz := 'UTC';
      local_now := now() at time zone 'UTC';
    end;
    local_today := local_now::date;

    if occ.task_type = 'weekly_checkin' then
      -- two days before it's due (Friday for a Sunday check-in), from 7am their time
      if not (occ.due_local_date between local_today and local_today + 2) then continue; end if;
      if local_now::time < '07:00'::time then continue; end if;
    else
      if occ.due_local_date <> local_today then continue; end if;
      if local_now::time < '09:00'::time then continue; end if;
    end if;

    -- Never a second request for the same period: one Nutrition Review a
    -- month (automated), one weekly check-in per 4 days, a coach's by hand included.
    if exists (
      select 1
      from public.messenger_checkins mc
      where mc.client_id = occ.client_id
        and mc.task_type = occ.task_type
        and mc.occurrence_id is distinct from occ.id
        and (
          (occ.task_type = 'nutrition_review'
            and mc.occurrence_id is not null
            and date_trunc('month', public.instant_to_local(mc.created_at, tz)) = date_trunc('month', local_today::timestamp))
          or
          (occ.task_type = 'weekly_checkin'
            and coalesce(mc.status, '') <> 'superseded'
            and public.instant_to_local(mc.created_at, tz)::date > local_today - 4)
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

-- ---------------------------------------------------------------------------

create or replace function public.enqueue_monthly_nutrition_updates()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  nutrition_form constant uuid := 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d';
  form_title text;
  fallback_admin uuid;
  rec record;
  tz text;
  local_now timestamp;
  local_date date;
  this_start date;
  prev_start date;
  card_date date;
  window_card boolean;
  send_now boolean;
  sender uuid;
  created_count integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('enqueue_monthly_nutrition_updates')) then
    return 0;
  end if;

  select f.title into form_title
    from public.nf_forms f
   where f.id = nutrition_form and f.active and not f.archived;
  if form_title is null then
    return 0; -- form switched off: nothing is sent
  end if;

  select ur.user_id into fallback_admin
    from public.user_roles ur
   where ur.role = 'admin'::public.app_role
   limit 1;

  for rec in
    select c.id as client_id, c.timezone, co.user_id as coach_user
      from public.clients c
      left join public.coaches co on co.id = c.assigned_coach_id
     where coalesce(c.archived, false) = false
       and coalesce(c.status, '') not in ('Deactivated', 'Deleted')
       and c.user_id is not null
       and c.service_tier = 'coaching'
       and exists (
         select 1 from public.nutrition_targets t
          where t.client_id = c.id
            and coalesce(t.status, '') <> 'Archived'
            and t.paused_at is null
            and coalesce(t.tracking_status, '') <> 'not_needed'
       )
  loop
    tz := coalesce(nullif(rec.timezone, ''), 'UTC');
    begin
      local_now := public.instant_to_local(now(), tz);
    exception when others then
      tz := 'UTC';
      local_now := now() at time zone 'UTC';
    end;
    local_date := local_now::date;

    -- With their weekly check-in: the last weekly card in the month's last 7 days (today, or a
    -- catch-up within 2 days), never a separate Monday form that week.
    select max(public.instant_to_local(mc.created_at, tz)::date) into card_date
      from public.messenger_checkins mc
     where mc.client_id = rec.client_id
       and mc.task_type = 'weekly_checkin'
       and mc.created_at > now() - interval '3 days';
    send_now := card_date is not null
      and card_date >= local_date - 2
      and extract(day from card_date) > extract(day from (date_trunc('month', card_date) + interval '1 month - 1 day')) - 7
      and local_now::time >= '07:00'::time;

    if not send_now then
      -- a weekly check-in is due to go out in this month's last 7 days: wait for it
      select exists (
        select 1 from public.client_task_occurrences o
         where o.client_id = rec.client_id
           and o.task_type = 'weekly_checkin'
           and o.status not in ('completed', 'skipped')
           and (o.due_local_date - 2) >= local_date
           and (o.due_local_date - 2) <= (date_trunc('month', local_date) + interval '1 month - 1 day')::date
           and extract(day from (o.due_local_date - 2)) > extract(day from (date_trunc('month', o.due_local_date - 2) + interval '1 month - 1 day')) - 7
      ) into window_card;
      if window_card then
        continue;
      end if;
      -- no weekly check-in in the window: the last Monday rule
      this_start := public.fn_last_monday_of_month(local_date);
      prev_start := public.fn_last_monday_of_month((date_trunc('month', local_date) - interval '1 day')::date);
      if not (local_date between this_start and this_start + 2
           or local_date between prev_start and prev_start + 2) then
        continue;
      end if;
      if local_now::time < '09:00'::time then
        continue;
      end if;
    end if;

    -- Never within 14 days of another request …
    if exists (
      select 1 from public.messages m
       where m.client_id = rec.client_id
         and m.created_at > now() - interval '14 days'
         and m.attachments @> jsonb_build_array(
               jsonb_build_object('kind', 'form_request', 'form_id', nutrition_form::text))
    ) then
      continue;
    end if;

    -- … or of one they sent in.
    if exists (
      select 1 from public.nf_submissions s
       where s.client_id = rec.client_id
         and s.form_id = nutrition_form
         and s.status <> 'in_progress'
         and s.submitted_at > now() - interval '14 days'
    ) then
      continue;
    end if;

    sender := coalesce(rec.coach_user, fallback_admin);
    if sender is null then
      continue;
    end if;

    insert into public.nf_assignments (form_id, client_id, recurrence, assigned_by, settings)
    values (nutrition_form, rec.client_id, 'none', sender, '{}'::jsonb)
    on conflict (form_id, client_id) do update set updated_at = now();

    insert into public.messages (
      client_id, sender_id, sender_role, body, attachments, message_type,
      is_internal_note, is_automated, delivery_status, sent_at, read_by_admin_at
    )
    values (
      rec.client_id,
      sender,
      'admin',
      'Time to update your nutrition 🍽️ Fill this out and I''ll build your new targets and meal plan.',
      jsonb_build_array(
        jsonb_build_object(
          'type', 'link',
          'kind', 'form_request',
          'url', '/portal/check-ins/' || nutrition_form::text,
          'form_id', nutrition_form::text,
          'assignment_client_ids', jsonb_build_array(rec.client_id),
          'request_title', form_title
        )
      ),
      'Form', false, true, 'sent', now(), now()
    );

    created_count := created_count + 1;
  end loop;

  return created_count;
end;
$$;

revoke all on function public.enqueue_monthly_nutrition_updates() from public, anon, authenticated;

-- every 15 minutes, a few minutes after the weekly check-in sender, so the Nutrition Update
-- follows that morning's weekly card before the 8am digest
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'nutrition-update-monthly' limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'nutrition-update-monthly',
    '7,22,37,52 * * * *',
    'select public.enqueue_monthly_nutrition_updates();'
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;
