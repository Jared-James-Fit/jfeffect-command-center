-- One check-in when the monthly Nutrition Update falls in a check-in week
-- (src/lib/checkin-coordination/nutrition-fold.ts, plan.ts).
--
-- The Nutrition Update is 24 questions, most of which (sex, height, allergies,
-- foods, schedule, the agreements) don't change month to month; 6 of 13
-- clients on a plan had never answered one. Now:
--
-- 1. It goes out when the plan is due its review, not at the end of every
--    month: the plan's own "Next update due" (nutrition_targets.end_date),
--    else its goal's rhythm (nutrition_review_weeks: fat loss 4 weeks, recomp
--    and gain 6, maintenance and performance 8) from the later of its start
--    and their last update. update_cadence belongs to a retired flow and is
--    'manual' on every plan, so it's never read. Never within 21 days of their
--    last update, never two requests within 25 days.
-- 2. With that week's check-in card: a client who has sent one before answers
--    it inside the check-in (only the meals and what changed; the rest carries
--    from their last update, weight and schedule from their records), so
--    there's no second form. messenger_checkins.nutrition_requested_at marks
--    it, nutrition_submission_id links the submission the check-in made. A
--    first one, or a client with no check-in coming, still gets the form.
-- 3. The form itself opens on their last answers for everything that doesn't
--    change month to month (validation.remember), never the meals question,
--    the foods to swap, "anything I missed" or the bodyweight.
-- The decision is nutritionUpdateDecision / nutritionReviewDue in plan.ts.

ALTER TABLE public.messenger_checkins ADD COLUMN IF NOT EXISTS nutrition_requested_at timestamptz;
ALTER TABLE public.messenger_checkins ADD COLUMN IF NOT EXISTS nutrition_submission_id uuid REFERENCES public.nf_submissions(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.nutrition_review_weeks(_phase text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(coalesce(_phase, '')) ~ '(loss|cut)' THEN 4
    WHEN lower(coalesce(_phase, '')) ~ 'recomp' THEN 6
    WHEN lower(coalesce(_phase, '')) ~ '(gain|bulk|reverse)' THEN 6
    WHEN lower(coalesce(_phase, '')) ~ '(maint|perform)' THEN 8
    ELSE 4
  END
$$;

CREATE OR REPLACE FUNCTION public.nutrition_review_due(_end date, _start date, _last date, _phase text)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _end IS NOT NULL THEN _end
    WHEN _start IS NULL AND _last IS NULL THEN NULL
    ELSE greatest(coalesce(_start, _last), coalesce(_last, _start)) + 7 * public.nutrition_review_weeks(_phase)
  END
$$;

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
  last_answered date;
  has_prior boolean;
  review_due date;
  last_asked timestamptz;
  wk_id uuid;
  wk_status text;
  coming boolean;
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
    select c.id as client_id, c.timezone, co.user_id as coach_user, t.end_date, t.start_date, t.phase
      from public.clients c
      left join public.coaches co on co.id = c.assigned_coach_id
      join lateral (
        select t.end_date, t.start_date, t.phase
          from public.nutrition_targets t
         where t.client_id = c.id
           and coalesce(t.status, '') <> 'Archived'
           and t.paused_at is null
           and coalesce(t.tracking_status, '') <> 'not_needed'
         order by t.start_date desc nulls last, t.created_at desc
         limit 1
      ) t on true
     where coalesce(c.archived, false) = false
       and coalesce(c.status, '') not in ('Deactivated', 'Deleted')
       and c.user_id is not null
       and c.service_tier = 'coaching'
  loop
    tz := coalesce(nullif(rec.timezone, ''), 'UTC');
    begin
      local_now := public.instant_to_local(now(), tz);
    exception when others then
      tz := 'UTC';
      local_now := now() at time zone 'UTC';
    end;
    local_date := local_now::date;
    if local_now::time < '07:00'::time then
      continue;
    end if;

    -- their last update
    select max(public.instant_to_local(s.submitted_at, tz)::date), count(*) > 0
      into last_answered, has_prior
      from public.nf_submissions s
     where s.client_id = rec.client_id
       and s.form_id = nutrition_form
       and s.status <> 'in_progress'
       and s.submitted_at is not null;

    -- only in the week the plan is due its review, never within 21 days of their last update
    review_due := public.nutrition_review_due(rec.end_date, rec.start_date, last_answered, rec.phase);
    if review_due is null or review_due > local_date + 7 then
      continue;
    end if;
    if last_answered is not null and last_answered > local_date - 21 then
      continue;
    end if;

    -- never two requests within 25 days: one in their chat, or one a weekly check-in carries
    -- (still open, or answered through it; one whose check-in went without it doesn't count)
    select greatest(
      (select max(m.created_at) from public.messages m
        where m.client_id = rec.client_id
          and m.attachments @> jsonb_build_array(jsonb_build_object('kind', 'form_request', 'form_id', nutrition_form::text))),
      (select max(mc.nutrition_requested_at) from public.messenger_checkins mc
        where mc.client_id = rec.client_id
          and mc.nutrition_requested_at is not null
          and (mc.status = 'pending' or mc.nutrition_submission_id is not null))
    ) into last_asked;
    if last_asked is not null and last_asked > now() - interval '25 days' then
      continue;
    end if;

    -- this week's check-in card (out in the last 2 days, their time)
    wk_id := null;
    wk_status := null;
    select mc.id, mc.status into wk_id, wk_status
      from public.messenger_checkins mc
     where mc.client_id = rec.client_id
       and mc.task_type = 'weekly_checkin'
       and coalesce(mc.status, '') <> 'superseded'
       and public.instant_to_local(mc.created_at, tz)::date >= local_date - 2
     order by mc.created_at desc
     limit 1;

    sender := coalesce(rec.coach_user, fallback_admin);
    if sender is null then
      continue;
    end if;

    if wk_id is not null and wk_status = 'pending' and has_prior then
      -- answered inside this week's check-in: no second form
      update public.messenger_checkins
         set nutrition_requested_at = now(), updated_at = now()
       where id = wk_id;
      insert into public.nf_assignments (form_id, client_id, recurrence, assigned_by, settings)
      values (nutrition_form, rec.client_id, 'none', sender, '{}'::jsonb)
      on conflict (form_id, client_id) do update set updated_at = now();
      created_count := created_count + 1;
      continue;
    end if;

    if not (wk_id is not null and not has_prior) then
      -- a check-in card still to come this week carries it
      select exists (
        select 1 from public.client_task_occurrences o
         where o.client_id = rec.client_id
           and o.task_type = 'weekly_checkin'
           and o.status not in ('completed', 'skipped')
           and (o.due_local_date - 2) between local_date and local_date + 7
      ) into coming;
      if coming then
        continue;
      end if;
      -- no check-ins coming: the form itself, on the day it's due
      if wk_id is null and (review_due > local_date or local_now::time < '09:00'::time) then
        continue;
      end if;
    end if;

    -- the form in their chat: their first one, or no check-in to carry it
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

-- ---------------------------------------------------------------------------
-- The form opens on their last answers for what doesn't change month to month.

UPDATE public.nf_questions
   SET validation = coalesce(validation, '{}'::jsonb) || '{"remember": true}'::jsonb
 WHERE form_id = 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d'
   AND archived_at IS NULL
   AND label !~* '(happen with the meals|which foods or meals do you want changed|anything i missed|fasted bodyweight)'
   AND NOT (coalesce(validation, '{}'::jsonb) ? 'remember');
