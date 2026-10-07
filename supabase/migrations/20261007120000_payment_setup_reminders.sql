-- Payment links stay alive until paid + automatic "finish your payment setup"
-- reminders in the client's chat.
--
-- 1. A Stripe Checkout Session lives at most 24h, so the /pay/<token> link a
--    client was sent used to say "expired" the next day and the coach had to
--    mint and send a new one (Reece and Amanda, Oct 2026). The app now mints a
--    fresh unpaid session on demand; these columns support that and let a link
--    carry a deliberate expiry date (NULL = never expires).
-- 2. run_payment_setup_reminders() nudges clients who were sent a payment link
--    and still have not paid.

alter table public.purchase_records
  add column if not exists payment_link_expires_at timestamptz,
  add column if not exists payment_reminders_paused boolean not null default false,
  add column if not exists payment_reminder_count smallint not null default 0,
  add column if not exists last_payment_reminder_at timestamptz;

comment on column public.purchase_records.payment_link_expires_at is
  'Optional explicit expiry for the client payment link. NULL (default) = the link never expires until the sale is paid.';
comment on column public.purchase_records.payment_reminders_paused is
  'When true, the automatic payment setup reminders skip this sale.';

-- Serialises on-demand Checkout Session creation per share link so two taps can
-- never leave two live sessions behind.
alter table public.payment_share_links
  add column if not exists regen_claimed_at timestamptz;

-- ─── Reminder job ────────────────────────────────────────────────────────────
-- Deliberately light: three chat reminders and one text over ~12 days, then it
-- stops. Waits are measured from the LAST payment-link message in the chat, so a
-- manual resend by the coach resets the clock.
--   day 1   chat reminder 1  (24h after the link)
--   day 3   one SMS "check your app messages" (see payment_sms_due below)
--   day 6   chat reminder 2  (5 days after reminder 1)
--   day 12  chat reminder 3, the last one (6 days after reminder 2)
-- Guard rails:
--   * only sales that are still awaiting payment, not archived, not paused and
--     not past an explicit link expiry
--   * only sales whose payment link was actually sent in the chat within the
--     last 21 days (old unpaid sales never get a surprise blast)
--   * only at the times people actually look: 11:30am-1:30pm (lunch) or
--     5:30pm-7:30pm (after work), in the client's timezone (America/Winnipeg
--     when unknown)
--   * holds off for 24h after the client last wrote, since they are engaged
--   * runs under a row lock, so overlapping runs never double send
create or replace function public.run_payment_setup_reminders(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_token text;
  v_url text;
  v_first_msg timestamptz;
  v_last_msg timestamptz;
  v_base timestamptz;
  v_sender uuid;
  v_tz text;
  v_local timestamp;
  v_minute integer;
  v_n integer;
  v_text text;
  v_cadence text;
  v_cur text;
  v_amount numeric;
  v_amount_text text;
  v_price text;
  v_offer text;
  v_what text;
  v_name text;
  v_greet text;
  v_body text;
  v_msg_id uuid;
  v_sent integer := 0;
  v_plan jsonb := '[]'::jsonb;
  waits constant interval[] := array[
    interval '24 hours', interval '120 hours', interval '144 hours'
  ];
  max_reminders constant integer := 3;
begin
  for rec in
    select pr.id, pr.client_id, pr.offer_name, pr.full_payable_amount, pr.currency,
           pr.payment_structure, pr.payment_frequency, pr.is_recurring,
           pr.payment_reminder_count, pr.last_payment_reminder_at,
           c.timezone, c.assigned_coach_id,
           coalesce(
             nullif(btrim(c.preferred_name), ''),
             nullif(btrim(c.first_name), ''),
             nullif(split_part(btrim(coalesce(c.full_name, '')), ' ', 1), '')
           ) as first_name
    from public.purchase_records pr
    join public.clients c on c.id = pr.client_id
    where pr.payment_status in ('Pending Payment', 'Payment Link Sent', 'Pending', 'Unpaid')
      and pr.archived_at is null
      and pr.payment_reminders_paused = false
      and pr.payment_reminder_count < max_reminders
      and (pr.payment_link_expires_at is null or pr.payment_link_expires_at > now())
      and coalesce(c.archived, false) = false
      and c.user_id is not null
    order by pr.purchased_at
    for update of pr skip locked
  loop
    -- The stable short link this sale's client was given.
    select l.token into v_token
    from public.payment_share_links l
    where l.purchase_record_id = rec.id and l.revoked = false
    order by l.created_at desc
    limit 1;
    if v_token is null then continue; end if;
    v_url := 'https://jfeffect.com/pay/' || v_token;

    -- When was the link sent in the chat? (card attachment or the plain link)
    select min(m.created_at), max(m.created_at)
      into v_first_msg, v_last_msg
    from public.messages m
    where m.client_id = rec.client_id
      and m.sender_role = 'admin'
      and m.deleted_at is null
      and coalesce(m.is_internal_note, false) = false
      and (
        m.attachments @> jsonb_build_array(jsonb_build_object('purchase_id', rec.id::text))
        or position('/pay/' || v_token in coalesce(m.body, '')) > 0
      );
    if v_first_msg is null or v_first_msg < now() - interval '21 days' then continue; end if;

    v_n := rec.payment_reminder_count + 1;
    v_base := greatest(v_last_msg, coalesce(rec.last_payment_reminder_at, v_last_msg));
    if now() < v_base + waits[v_n] then continue; end if;

    -- The client wrote recently: they are engaged, give them space.
    if exists (
      select 1 from public.messages m
      where m.client_id = rec.client_id
        and m.sender_role = 'client'
        and m.deleted_at is null
        and m.created_at > now() - interval '24 hours'
    ) then continue; end if;

    -- Only message when people actually look: lunch or after work, local time.
    v_tz := coalesce(nullif(rec.timezone, ''), 'America/Winnipeg');
    if not exists (select 1 from pg_timezone_names z where z.name = v_tz) then
      v_tz := 'America/Winnipeg';
    end if;
    v_local := now() at time zone v_tz;
    v_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
    if not ((v_minute >= 690 and v_minute < 810) or (v_minute >= 1050 and v_minute < 1170)) then
      continue;
    end if;

    -- Send from whoever sent the link, else the assigned coach, else an admin.
    select m.sender_id into v_sender
    from public.messages m
    where m.client_id = rec.client_id
      and m.sender_role = 'admin'
      and m.deleted_at is null
      and (
        m.attachments @> jsonb_build_array(jsonb_build_object('purchase_id', rec.id::text))
        or position('/pay/' || v_token in coalesce(m.body, '')) > 0
      )
    order by m.created_at desc
    limit 1;
    if v_sender is null then
      select co.user_id into v_sender from public.coaches co where co.id = rec.assigned_coach_id;
    end if;
    if v_sender is null then
      select ur.user_id into v_sender
      from public.user_roles ur where ur.role = 'admin'::public.app_role limit 1;
    end if;
    if v_sender is null then continue; end if;

    -- Price line, mirroring the message sent when the product was assigned.
    v_text := lower(coalesce(rec.payment_frequency, '') || ' ' || coalesce(rec.payment_structure, ''));
    v_cadence := case
      when v_text ~ 'one[- ]?time|paid in full|pay in full' and not coalesce(rec.is_recurring, false) then null
      when v_text ~ 'bi-?weekly|every 2 weeks' then ' every 2 weeks'
      when v_text ~ 'week' then '/week'
      when v_text ~ 'year|annual' then '/year'
      when coalesce(rec.is_recurring, false) or v_text ~ 'month|subscription|recurring' then '/month'
      else null
    end;
    v_cur := upper(coalesce(nullif(rec.currency, ''), 'CAD'));
    v_amount := coalesce(rec.full_payable_amount, 0);
    if v_amount > 0 then
      v_amount_text := case
        when v_amount = trunc(v_amount) then trim(to_char(v_amount, 'FM999,999,990'))
        else trim(to_char(v_amount, 'FM999,999,990.00'))
      end;
      v_price := case
        when v_cur in ('CAD', 'USD') then '$' || v_amount_text
        else v_amount_text || ' ' || v_cur
      end || coalesce(v_cadence, '') || ' + applicable tax';
    else
      v_price := null;
    end if;

    v_offer := coalesce(nullif(btrim(rec.offer_name), ''), 'coaching');
    -- Some offer names already carry the price ("Online Coaching - $130/month");
    -- don't repeat it in brackets.
    v_what := v_offer || case
      when v_price is not null and position(v_amount_text in v_offer) = 0 then ' (' || v_price || ')'
      else ''
    end;
    v_name := coalesce(nullif(rec.first_name, ''), 'Hey');
    v_greet := case
      when nullif(rec.first_name, '') is not null then 'Hey ' || rec.first_name || '! 👋'
      else 'Hey! 👋'
    end;

    v_body := case v_n
      when 1 then
        v_greet || ' Quick reminder to finish setting up your payment for ' || v_what || '.'
        || E'\n\nHere''s your link:\n\n' || v_url
        || E'\n\nTakes about a minute, and the link doesn''t expire, so do it whenever suits you. 💪'
      when 2 then
        v_name || ', I still need your payment details for ' || v_what || ' so we can get it locked in. Same link as before:'
        || E'\n\n' || v_url
        || E'\n\nIf something isn''t working or you''d rather pay another way, just reply here and I''ll sort it.'
      else
        'Last nudge from me, ' || v_name || '. Your ' || v_offer || ' payment still isn''t set up:'
        || E'\n\n' || v_url
        || E'\n\nThe link stays active, so it''s there whenever you''re ready. If you want to change the plan or have questions, reply here and I''ll help.'
    end;

    if p_dry_run then
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'purchase_id', rec.id, 'client_id', rec.client_id,
        'reminder_number', v_n, 'sender_id', v_sender, 'body', v_body
      ));
      continue;
    end if;

    begin
      insert into public.messages (
        client_id, sender_id, sender_role, body, attachments, message_type,
        is_internal_note, is_automated, delivery_status, sent_at, read_by_admin_at
      ) values (
        rec.client_id, v_sender, 'admin', v_body,
        jsonb_build_array(jsonb_build_object(
          'type', 'link',
          'kind', 'payment_request',
          'url', v_url,
          'payment_url', v_url,
          'name', 'Payment: ' || v_offer,
          'title', v_offer,
          'amount_cents', round(v_amount * 100)::bigint,
          'currency', v_cur,
          'payment_structure', rec.payment_structure,
          'purchase_id', rec.id,
          'status', 'Pending Payment'
        )),
        'Payment', false, true, 'sent', now(), now()
      )
      returning id into v_msg_id;

      update public.purchase_records
         set payment_reminder_count = v_n,
             last_payment_reminder_at = now()
       where id = rec.id;

      v_sent := v_sent + 1;
    exception when others then
      -- One bad row must never stop the rest of the batch.
      raise warning 'payment setup reminder failed for purchase %: %', rec.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'sent', v_sent, 'would_send', v_plan);
end;
$$;

revoke all on function public.run_payment_setup_reminders(boolean) from public, anon, authenticated;

-- Database-native schedule (no page has to be open). Runs in SQL on purpose:
-- it does not depend on an HTTP hook or a worker secret. Every 30 minutes at
-- :07 and :37 to stay clear of the other jobs (it only acts inside the lunch /
-- after-work windows above).
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'payment-setup-reminders' limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'payment-setup-reminders',
    '7,37 * * * *',
    'select public.run_payment_setup_reminders();'
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;

-- ─── One SMS: "check your app messages" ──────────────────────────────────────
-- Sent once per sale, about 3 days after the link, only if the client still has
-- not paid and has already had the day-1 chat reminder. It never contains the
-- payment link, it just points them at the app. Same send windows as the chat
-- reminders. Sending needs Twilio, which lives in the app server, so a
-- scheduled call hits /api/public/hooks/payment-reminder-sms; this function
-- decides who is due.
alter table public.purchase_records
  add column if not exists payment_sms_sent_at timestamptz,
  add column if not exists payment_sms_attempts smallint not null default 0;

create or replace function public.payment_sms_due()
returns table (o_purchase_id uuid, o_client_id uuid, o_first_name text, o_phone text, o_offer text)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_token text;
  v_first_msg timestamptz;
  v_tz text;
  v_local timestamp;
  v_minute integer;
begin
  for rec in
    select pr.id, pr.client_id, pr.offer_name, c.timezone,
           coalesce(nullif(c.normalized_phone, ''), nullif(c.phone, '')) as phone,
           coalesce(
             nullif(btrim(c.preferred_name), ''),
             nullif(btrim(c.first_name), ''),
             nullif(split_part(btrim(coalesce(c.full_name, '')), ' ', 1), '')
           ) as first_name
    from public.purchase_records pr
    join public.clients c on c.id = pr.client_id
    where pr.payment_status in ('Pending Payment', 'Payment Link Sent', 'Pending', 'Unpaid')
      and pr.archived_at is null
      and pr.payment_reminders_paused = false
      and pr.payment_sms_sent_at is null
      and pr.payment_sms_attempts < 3
      and pr.payment_reminder_count >= 1
      and (pr.last_payment_reminder_at is null or pr.last_payment_reminder_at <= now() - interval '20 hours')
      and (pr.payment_link_expires_at is null or pr.payment_link_expires_at > now())
      and coalesce(c.archived, false) = false
      and c.user_id is not null
      and coalesce(c.sms_opt_out, false) = false
      and coalesce(nullif(c.normalized_phone, ''), nullif(c.phone, '')) is not null
    order by pr.purchased_at
  loop
    select l.token into v_token
    from public.payment_share_links l
    where l.purchase_record_id = rec.id and l.revoked = false
    order by l.created_at desc
    limit 1;
    if v_token is null then continue; end if;

    select min(m.created_at) into v_first_msg
    from public.messages m
    where m.client_id = rec.client_id
      and m.sender_role = 'admin'
      and m.deleted_at is null
      and coalesce(m.is_internal_note, false) = false
      and (
        m.attachments @> jsonb_build_array(jsonb_build_object('purchase_id', rec.id::text))
        or position('/pay/' || v_token in coalesce(m.body, '')) > 0
      );
    -- About 3 days after the link, and still inside the 21 day window.
    if v_first_msg is null
       or v_first_msg > now() - interval '72 hours'
       or v_first_msg < now() - interval '21 days' then
      continue;
    end if;

    -- The client wrote recently: they are engaged, no text.
    if exists (
      select 1 from public.messages m
      where m.client_id = rec.client_id
        and m.sender_role = 'client'
        and m.deleted_at is null
        and m.created_at > now() - interval '24 hours'
    ) then continue; end if;

    -- Never text the same client twice within 2 days.
    if exists (
      select 1 from public.sms_log s
      where s.client_id = rec.client_id
        and s.status = 'sent'
        and s.automation_trigger = 'payment_setup_reminder'
        and s.created_at > now() - interval '48 hours'
    ) then continue; end if;

    v_tz := coalesce(nullif(rec.timezone, ''), 'America/Winnipeg');
    if not exists (select 1 from pg_timezone_names z where z.name = v_tz) then
      v_tz := 'America/Winnipeg';
    end if;
    v_local := now() at time zone v_tz;
    v_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
    if not ((v_minute >= 690 and v_minute < 810) or (v_minute >= 1050 and v_minute < 1170)) then
      continue;
    end if;

    o_purchase_id := rec.id;
    o_client_id := rec.client_id;
    o_first_name := rec.first_name;
    o_phone := rec.phone;
    o_offer := rec.offer_name;
    return next;
  end loop;
end;
$$;

-- Claim a sale's one SMS before sending (so two overlapping runs can't both
-- text), and release it again if Twilio fails so it can be retried (max 3).
create or replace function public.claim_payment_sms(p_purchase_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.purchase_records
     set payment_sms_sent_at = now(),
         payment_sms_attempts = payment_sms_attempts + 1
   where id = p_purchase_id
     and payment_sms_sent_at is null
     and payment_sms_attempts < 3;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

create or replace function public.release_payment_sms(p_purchase_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.purchase_records set payment_sms_sent_at = null where id = p_purchase_id;
$$;

-- A private random secret for the scheduled call. It is generated inside the
-- database, kept in Vault, and never written to the repo. The cron job reads it
-- and the hook compares against it through payment_reminder_hook_secret().
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'payment_reminder_hook_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'payment_reminder_hook_secret',
      'Auth for the payment-reminder-sms scheduled hook'
    );
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    null;
end
$$;

create or replace function public.payment_reminder_hook_secret()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'payment_reminder_hook_secret' limit 1;
$$;

revoke all on function public.payment_sms_due() from public, anon, authenticated;
revoke all on function public.claim_payment_sms(uuid) from public, anon, authenticated;
revoke all on function public.release_payment_sms(uuid) from public, anon, authenticated;
revoke all on function public.payment_reminder_hook_secret() from public, anon, authenticated;
grant execute on function public.payment_sms_due() to service_role;
grant execute on function public.claim_payment_sms(uuid) to service_role;
grant execute on function public.release_payment_sms(uuid) to service_role;
grant execute on function public.payment_reminder_hook_secret() to service_role;

-- Every 30 minutes at :12 and :42 (the hook only acts inside the send windows).
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'payment-reminder-sms' limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'payment-reminder-sms',
    '12,42 * * * *',
    $cmd$
    select net.http_post(
      url := 'https://project--5f1f340c-5afa-4262-90c8-1f9406568c6c.lovable.app/api/public/hooks/payment-reminder-sms',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reminder-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'payment_reminder_hook_secret' limit 1)
      ),
      body := '{}'::jsonb
    ) as request_id;
    $cmd$
  );
exception
  when undefined_table or undefined_function then
    null;
end
$$;
