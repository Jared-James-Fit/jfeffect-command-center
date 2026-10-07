-- Nutrition Update Request repeats monthly, on the Monday that starts the final
-- week of each month (9am in the client's time zone). Replaces the retired
-- Nutrition Review.
--
-- Who: clients who have been sent the Nutrition Update Request at least once
-- (they hold an nf_assignment for it), are not archived and have an account.
-- Sending the first one manually is what puts a client on the monthly loop.
--
-- Safety: once per month by construction (the only window is the Monday plus
-- two days of catch-up, and nothing is sent if a Nutrition Update request went
-- to that client in the last 14 days, manual or automatic). Safe to re-run.

create or replace function public.fn_last_monday_of_month(_d date)
returns date
language sql
immutable
as $$
  select month_end - ((extract(dow from month_end)::int - 1 + 7) % 7)
  from (select (date_trunc('month', _d) + interval '1 month - 1 day')::date as month_end) m;
$$;

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
    select distinct c.id as client_id, c.timezone, co.user_id as coach_user
      from public.nf_assignments a
      join public.clients c on c.id = a.client_id
      left join public.coaches co on co.id = c.assigned_coach_id
     where a.form_id = nutrition_form
       and coalesce(c.archived, false) = false
       and c.user_id is not null
  loop
    tz := coalesce(nullif(rec.timezone, ''), 'UTC');
    begin
      local_now := now() at time zone tz;
    exception when others then
      tz := 'UTC';
      local_now := now() at time zone 'UTC';
    end;
    local_date := local_now::date;

    -- Start of the final week: this month's last Monday, or last month's (the
    -- catch-up days can spill into the next month).
    this_start := public.fn_last_monday_of_month(local_date);
    prev_start := public.fn_last_monday_of_month((date_trunc('month', local_date) - interval '1 day')::date);
    if not (local_date between this_start and this_start + 2
         or local_date between prev_start and prev_start + 2) then
      continue;
    end if;

    -- Land at 9am their time, not at midnight.
    if local_now::time < '09:00'::time then
      continue;
    end if;

    -- One per month: skip if any Nutrition Update request already went out recently.
    if exists (
      select 1
        from public.messages m
       where m.client_id = rec.client_id
         and m.created_at > now() - interval '14 days'
         and m.attachments @> jsonb_build_array(
               jsonb_build_object('kind', 'form_request', 'form_id', nutrition_form::text))
    ) then
      continue;
    end if;

    sender := coalesce(rec.coach_user, fallback_admin);
    if sender is null then
      continue;
    end if;

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
      'Form',
      false,
      true,
      'sent',
      now(),
      now()
    );

    created_count := created_count + 1;
  end loop;

  return created_count;
end;
$$;

revoke all on function public.enqueue_monthly_nutrition_updates() from public, anon, authenticated;

-- Hourly is plenty: the function itself decides whether anyone is due.
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
    '7 * * * *',
    'select public.enqueue_monthly_nutrition_updates();'
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;
