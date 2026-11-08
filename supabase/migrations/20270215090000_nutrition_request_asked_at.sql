-- A Nutrition Update request moves its "asked" time, whoever sends it.
--
-- The app reads when a client was last asked for the one-off Nutrition Update
-- form from nf_assignments.updated_at (a coach's send upserts it, so the
-- updated_at trigger moves it). The monthly job only inserted the assignment
-- ("on conflict do nothing"), so its requests never moved it: Jared and David
-- were still "asked Oct 4" after the Oct 26 / Oct 28 requests. The form then
-- opened as the last submission ("submitted") instead of a fresh one for the
-- new month, and the coach's panel read the wrong request.
--
-- Also: the job asked David again 9 days after he'd sent one (it only looked
-- at requests, not answers), it now goes to coaching clients only (members
-- never get the coach's check-ins), and it reads the client's clock through
-- instant_to_local (Manitoba is UTC-5 from Nov 1 2026).

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
  sender uuid;
  created_count integer := 0;
begin
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
       and c.user_id is not null
       and c.service_tier = 'coaching'
       and exists (
         select 1 from public.nutrition_targets t
          where t.client_id = c.id
            and coalesce(t.status, '') <> 'Archived'
            and t.paused_at is null
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

    this_start := public.fn_last_monday_of_month(local_date);
    prev_start := public.fn_last_monday_of_month((date_trunc('month', local_date) - interval '1 day')::date);
    if not (local_date between this_start and this_start + 2
         or local_date between prev_start and prev_start + 2) then
      continue;
    end if;

    if local_now::time < '09:00'::time then
      continue;
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

    -- The client must be assigned the form to open it, and this is when they
    -- were asked (updated_at), like a coach's send.
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

-- The requests already out: each assignment's "asked" is its latest request
-- message (only where that's later). The updated_at trigger would stamp now(),
-- which reads as asked after the answer, so it's held off for this update.
alter table public.nf_assignments disable trigger nf_assignments_set_updated_at;

update public.nf_assignments a
   set updated_at = r.asked
  from (
    select m.client_id, max(m.created_at) as asked
      from public.messages m
     where m.attachments @> '[{"kind":"form_request","form_id":"b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d"}]'
     group by 1
  ) r
 where a.client_id = r.client_id
   and a.form_id = 'b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d'
   and a.recurrence = 'none'
   and r.asked > a.updated_at + interval '60 seconds';

alter table public.nf_assignments enable trigger nf_assignments_set_updated_at;
