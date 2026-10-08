-- Check-in "reviewed" state, so "Review Due" on the Clients page closes by itself.
--
-- Until now a chat check-in (messenger_checkins) had no reviewed flag, and the Clients
-- page counted old external-form submissions instead, so "Review Due" never matched what
-- the coach had actually handled. Now:
--   * messenger_checkins gets reviewed_at / reviewed_by / reviewed_via
--   * a staff reply in the client's chat closes their open check-ins and native forms
--     (internal notes, automated messages, scheduled-not-sent messages and form requests
--     don't count)
--   * mark_checkin_reviewed() / mark_client_reviews_reviewed() are the one-tap "Mark
--     reviewed" actions (admin or the client's assigned coach)
--   * Review Due counts open check-ins + native forms + external forms from the last 30 days

alter table public.messenger_checkins
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_via text;

create index if not exists messenger_checkins_open_review_idx
  on public.messenger_checkins (client_id)
  where status = 'completed' and reviewed_at is null and superseded_at is null;

-- Staff reply => reviewed ---------------------------------------------------------
create or replace function public.tg_staff_reply_closes_reviews()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.sender_role = 'client'
     or coalesce(new.is_internal_note, false)
     or coalesce(new.is_automated, false)
     or new.deleted_at is not null
     or new.scheduled_at is not null
     or coalesce(new.attachments::text, '') ilike '%form_request%' then
    return new;
  end if;

  update public.messenger_checkins
     set reviewed_at = now(), reviewed_by = new.sender_id, reviewed_via = 'reply'
   where client_id = new.client_id
     and status = 'completed' and superseded_at is null and reviewed_at is null
     and submitted_at <= new.created_at;

  update public.nf_submissions
     set status = 'reviewed', reviewed_at = now(), reviewed_by = new.sender_id
   where client_id = new.client_id
     and submitted_at is not null and reviewed_at is null
     and status in ('submitted','pending_review')
     and submitted_at <= new.created_at;

  return new;
end
$$;

drop trigger if exists staff_reply_closes_reviews on public.messages;
create trigger staff_reply_closes_reviews
  after insert on public.messages
  for each row execute function public.tg_staff_reply_closes_reviews();

-- One-tap actions -----------------------------------------------------------------
create or replace function public.mark_checkin_reviewed(_checkin_id uuid, _via text default 'manual')
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_client uuid;
  v_n int;
begin
  select client_id into v_client from public.messenger_checkins where id = _checkin_id;
  if v_client is null then return false; end if;
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or public.is_assigned_coach(v_client)) then
    raise exception 'Not allowed';
  end if;
  update public.messenger_checkins
     set reviewed_at = now(), reviewed_by = auth.uid(), reviewed_via = coalesce(nullif(_via, ''), 'manual')
   where id = _checkin_id and reviewed_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end
$$;

create or replace function public.reopen_checkin_review(_checkin_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_client uuid;
  v_n int;
begin
  select client_id into v_client from public.messenger_checkins where id = _checkin_id;
  if v_client is null then return false; end if;
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or public.is_assigned_coach(v_client)) then
    raise exception 'Not allowed';
  end if;
  update public.messenger_checkins
     set reviewed_at = null, reviewed_by = null, reviewed_via = null
   where id = _checkin_id and reviewed_at is not null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end
$$;

-- Closes everything "Review Due" counts for one client. Returns how many items it closed.
create or replace function public.mark_client_reviews_reviewed(_client_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a int := 0; b int := 0; c int := 0;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or public.is_assigned_coach(_client_id)) then
    raise exception 'Not allowed';
  end if;

  update public.messenger_checkins
     set reviewed_at = now(), reviewed_by = auth.uid(), reviewed_via = 'manual'
   where client_id = _client_id and status = 'completed' and superseded_at is null and reviewed_at is null;
  get diagnostics a = row_count;

  update public.nf_submissions
     set status = 'reviewed', reviewed_at = now(), reviewed_by = auth.uid()
   where client_id = _client_id and submitted_at is not null and reviewed_at is null
     and status in ('submitted','pending_review');
  get diagnostics b = row_count;

  update public.submission_reviews
     set review_status = 'no_response'
   where client_id = _client_id and source_type <> 'native'
     and coalesce(review_status,'') in ('pending','needs_review','submitted');
  get diagnostics c = row_count;

  return a + b + c;
end
$$;

revoke all on function public.mark_checkin_reviewed(uuid, text) from public, anon;
revoke all on function public.reopen_checkin_review(uuid) from public, anon;
revoke all on function public.mark_client_reviews_reviewed(uuid) from public, anon;
grant execute on function public.mark_checkin_reviewed(uuid, text) to authenticated, service_role;
grant execute on function public.reopen_checkin_review(uuid) to authenticated, service_role;
grant execute on function public.mark_client_reviews_reviewed(uuid) to authenticated, service_role;

-- Backfill: anything a staff member already replied to afterwards counts as reviewed -----
with staff as (
  select client_id, created_at from public.messages
   where sender_role <> 'client'
     and coalesce(is_internal_note, false) = false and coalesce(is_automated, false) = false
     and deleted_at is null and scheduled_at is null
     and coalesce(attachments::text, '') not ilike '%form_request%'
)
update public.messenger_checkins mc
   set reviewed_at = now(), reviewed_via = 'backfill'
 where mc.status = 'completed' and mc.reviewed_at is null
   and exists (select 1 from staff s where s.client_id = mc.client_id and s.created_at >= mc.submitted_at);

-- Directory: Review Due now reads the real state --------------------------------------
create or replace function public.admin_clients_directory(
  p_search text default null,
  p_status text default null,
  p_coaching_type text default null,
  p_coach_id uuid default null,
  p_sort text default 'attention',
  p_limit integer default 15,
  p_offset integer default 0,
  p_lifecycle text default 'active',
  p_flags text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_today date := (now() at time zone 'utc')::date;
  v_lifecycle text := coalesce(nullif(p_lifecycle, ''), 'active');
  -- Every filter the caller asked for; a client must match ALL of them. p_status is the
  -- older single-filter spelling, folded in so a build that predates p_flags keeps working.
  v_flags text[] := coalesce((
    select array_agg(distinct t.f)
    from unnest(coalesce(p_flags, '{}'::text[]) || array[coalesce(p_status, '')]) as t(f)
    where t.f <> '' and t.f <> 'all'
  ), '{}'::text[]);
  v_rows jsonb;
  v_total int;
  v_counts jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  with base as (
    select c.*
    from public.clients c
    where (v_is_admin or public.is_assigned_coach(c.id))
      and (
        (v_lifecycle = 'active'      and c.archived = false and coalesce(c.status,'') not in ('Archived','Deactivated'))
        or (v_lifecycle = 'archived'    and (c.archived = true or c.status = 'Archived'))
        or (v_lifecycle = 'deactivated' and c.status = 'Deactivated')
      )
  ),
  valid_blocks as (
    select b.client_id, b.id, b.name, b.start_date, b.end_date, b.status
    from public.pl_blocks b
    where b.archived = false
      and coalesce(b.status, '') <> 'Archived'
      and b.start_date is not null
      and b.client_id in (select id from base)
  ),
  -- The block running today (prefer the one marked Active, then the latest
  -- start); if none is running, the one that ended within the last 7 days.
  cur_block as (
    select distinct on (vb.client_id)
      vb.client_id, vb.id, vb.name, vb.start_date, vb.end_date, vb.status
    from valid_blocks vb
    where vb.start_date <= v_today and vb.end_date is not null and vb.end_date >= v_today - 7
       or vb.start_date <= v_today and vb.end_date is null
    order by vb.client_id,
      (case when vb.end_date is null or vb.end_date >= v_today then 0 else 1 end),
      (case when vb.status = 'Active' then 0 else 1 end),
      vb.start_date desc
  ),
  next_block as (
    select distinct on (vb.client_id)
      vb.client_id, vb.id, vb.name, vb.start_date, vb.end_date, vb.status
    from valid_blocks vb
    where vb.start_date > v_today
    order by vb.client_id, vb.start_date asc, (case when vb.status = 'Active' then 0 else 1 end)
  ),
  cur_nut as (
    select distinct on (client_id) client_id, start_date, end_date, status
    from public.nutrition_targets
    where client_id in (select id from base)
    order by client_id, coalesce(start_date, '1900-01-01'::date) desc
  ),
  cur_card as (
    select distinct on (client_id) client_id, start_date, end_date, status
    from public.cardio_targets
    where client_id in (select id from base)
    order by client_id, coalesce(start_date, '1900-01-01'::date) desc
  ),
  -- "Review Due" = something the client sent that nobody on staff has dealt with yet:
  -- an in-app check-in, a native form, or (last 30 days only) an external form.
  -- A staff reply in the chat closes the first two automatically (trigger below).
  pending_reviews as (
    select x.client_id, sum(x.n)::bigint as n
    from (
      select mc.client_id, count(*) as n
      from public.messenger_checkins mc
      where mc.client_id in (select id from base)
        and mc.status = 'completed' and mc.superseded_at is null and mc.reviewed_at is null
      group by mc.client_id
      union all
      select s.client_id, count(*)
      from public.nf_submissions s
      where s.client_id in (select id from base)
        and s.submitted_at is not null and s.reviewed_at is null
        and s.status in ('submitted','pending_review')
      group by s.client_id
      union all
      select r.client_id, count(*)
      from public.submission_reviews r
      where r.client_id in (select id from base)
        and r.source_type <> 'native'
        and coalesce(r.review_status,'') in ('pending','needs_review','submitted')
        and r.submitted_at > now() - interval '30 days'
      group by r.client_id
    ) x
    group by x.client_id
  ),
  missed as (
    select sw.client_id, count(*)::int as n
    from public.pl_scheduled_workouts sw
    where sw.client_id in (select id from base)
      and sw.scheduled_date between v_today - 14 and v_today - 1
      and not exists (
        select 1 from public.pl_day_completions dc
        where dc.scheduled_workout_id = sw.id and dc.completed_at is not null
      )
    group by sw.client_id
  ),
  pay as (
    select pr.client_id,
      bool_or(pr.payment_status in ('Overdue','Failed') and coalesce(pr.service_status,'') <> 'Cancelled') as p_bad,
      bool_or(pr.payment_status in ('Active Subscription','Paid','Partially Paid')
              and coalesce(pr.service_status,'') not in ('Cancelled','Expired')) as p_good,
      bool_or(pr.payment_status in ('Pending Payment','Pending','Unpaid','Payment Link Sent')) as p_pending
    from public.purchase_records pr
    where pr.archived_at is null
      and pr.client_id in (select id from base)
    group by pr.client_id
  ),
  enriched as (
    select
      b.id, b.full_name, b.email, b.profile_picture_url, b.coaching_type,
      b.assigned_coach_id, b.status as client_status, b.account_status,
      b.payment_status, b.needs_admin_help, b.created_at, b.updated_at,
      b.next_program_update,
      b.last_active_at,
      b.last_signed_in_at as last_login_at,
      co.full_name as coach_name,
      cb.id as block_id, cb.name as block_name,
      cb.start_date as block_start, cb.end_date as block_end, cb.status as block_status,
      nb.id as next_block_id, nb.name as next_block_name,
      nb.start_date as next_block_start, nb.end_date as next_block_end, nb.status as next_block_status,
      cn.end_date as nut_end,
      cc.end_date as card_end,
      coalesce(pr.n, 0) as pending_reviews,
      ag.status as coaching_agreement_status,
      ag.signed_at as coaching_agreement_signed_at,
      ag.signed_version as coaching_agreement_version,
      ag.resign_requested_at as coaching_agreement_requested_at,
      ag.exempt_kind as coaching_agreement_exempt_kind,
      ag.last_reminded_at as coaching_agreement_reminded_at,
      coalesce(ag.status not in ('signed', 'exempt'), false) as f_no_contract,
      (
        (
          not (b.account_status in ('Account Created','Active') or b.last_signed_in_at is not null)
          and (
            b.account_status in ('Invite Not Sent','Invite Sent','Invite Expired','Password Reset Sent')
            or (b.agreement_status is not null and b.agreement_status in ('Not Sent','Sent','Pending'))
          )
        )
        or coalesce(array_length(b.preferred_training_days, 1), 0) = 0
      ) as f_needs_setup,
      (coalesce(pr.n,0) > 0) as f_needs_review,
      (cb.end_date is not null and cb.end_date between v_today and v_today + 14 and nb.id is null) as f_program_ending,
      ((cb.id is null or (cb.end_date is not null and cb.end_date < v_today)) and nb.id is null) as f_missing_program,
      ((lower(coalesce(b.payment_status,'')) in ('overdue','failed','past_due','past due'))
        or b.status = 'Payment Overdue'
        or coalesce(py.p_bad, false)) as f_payment_issue,
      (b.created_at > now() - interval '7 days'
        and b.account_status not in ('Active')) as f_new_client,
      (cn.client_id is null or (cn.end_date is not null and cn.end_date < v_today)) as f_missing_nutrition,
      (cc.client_id is null or (cc.end_date is not null and cc.end_date < v_today)) as f_missing_cardio,
      (cb.id is not null and (cb.end_date is null or cb.end_date >= v_today)) as f_has_active_program,
      (b.account_status in ('Account Created','Active') or b.last_signed_in_at is not null) as f_account_activated,
      coalesce(ms.n, 0) as missed_workouts_count,
      (coalesce(ms.n, 0) >= 2) as f_missed_workouts,
      (v_today - coalesce(b.last_active_at, b.last_signed_in_at)::date) as days_inactive,
      (cb.id is not null and (cb.end_date is null or cb.end_date >= v_today)
        and coalesce(b.last_active_at, b.last_signed_in_at) is not null
        and (v_today - coalesce(b.last_active_at, b.last_signed_in_at)::date) >= 7) as f_inactive,
      case
        when lower(coalesce(b.payment_status,'')) in ('complimentary','exempt') then 'exempt'
        when coalesce(py.p_bad, false) then 'past_due'
        when coalesce(py.p_good, false) then 'ok'
        when coalesce(py.p_pending, false) then 'pending'
        else 'not_set_up'
      end as payment_state
    from base b
    left join public.coaches co on co.id = b.assigned_coach_id
    left join cur_block cb on cb.client_id = b.id
    left join next_block nb on nb.client_id = b.id
    left join cur_nut cn on cn.client_id = b.id
    left join cur_card cc on cc.client_id = b.id
    left join pending_reviews pr on pr.client_id = b.id
    left join missed ms on ms.client_id = b.id
    left join pay py on py.client_id = b.id
    left join public.coaching_agreement_client_status ag on ag.client_id = b.id
  ),
  scored as (
    select e.*,
      (e.payment_state = 'not_set_up') as f_no_payment,
      (e.payment_state = 'pending') as f_payment_pending,
      case
        when f_payment_issue then 1
        when f_needs_setup and not f_account_activated then 2
        when f_needs_review then 3
        when payment_state = 'not_set_up' then 4
        when f_no_contract then 5
        when f_missing_program then 6
        when f_program_ending then 7
        when f_missing_nutrition or f_missing_cardio then 8
        when f_needs_setup then 9
        else 10
      end as priority,
      case
        when f_payment_issue then jsonb_build_object('kind','payment','label','Resolve Payment')
        when f_needs_setup and not f_account_activated then jsonb_build_object('kind','setup','label','Open Client')
        when f_needs_review then jsonb_build_object('kind','review','label','Review Check-In')
        when payment_state = 'not_set_up' then jsonb_build_object('kind','payment','label','Set Up Payment')
        when f_missing_program and f_has_active_program = false then jsonb_build_object('kind','assign','label','Assign Program')
        when f_missing_program then jsonb_build_object('kind','assign','label','Assign Next Program')
        when f_program_ending then jsonb_build_object('kind','next_phase','label','Build Next Phase')
        when f_missing_nutrition then jsonb_build_object('kind','nutrition','label','Update Nutrition')
        when f_missing_cardio then jsonb_build_object('kind','cardio','label','Update Cardio')
        else jsonb_build_object('kind','open','label','Open Client')
      end as next_action,
      -- The filters a client matches. Each filter is defined once, here; the list filter
      -- and the per-filter counts below both read it. Keep the keys in step with
      -- src/components/clients/clients-status.ts (a test compares them).
      array_remove(array[
        -- flags:begin
        case when f_needs_setup and not f_account_activated then 'needs_setup' end,
        case when f_needs_review then 'needs_review' end,
        case when f_program_ending then 'program_ending' end,
        case when f_payment_issue then 'payment_issues' end,
        case when payment_state = 'not_set_up' then 'no_payment' end,
        case when payment_state = 'pending' then 'payment_pending' end,
        case when f_new_client then 'new_clients' end,
        case when f_missed_workouts then 'missed_workouts' end,
        case when f_inactive then 'inactive' end,
        case when f_no_contract then 'no_contract' end,
        case when f_missing_program then 'no_program' end,
        case when f_missing_nutrition then 'no_nutrition' end,
        case when f_missing_cardio then 'no_cardio' end
        -- flags:end
      ], null) as flags
    from enriched e
  ),
  count_source as (
    select s.*
    from scored s
    where (p_search is null or p_search = '' or
           s.full_name ilike '%' || p_search || '%' or
           s.email ilike '%' || p_search || '%')
      and (p_coaching_type is null or p_coaching_type = '' or p_coaching_type = 'all'
           or s.coaching_type = p_coaching_type)
      and (p_coach_id is null or s.assigned_coach_id = p_coach_id)
  ),
  filtered as (
    select cs.*
    from count_source cs
    where cs.flags @> v_flags
  ),
  ordered as (
    select *,
      row_number() over (
        order by
          case when p_sort = 'attention' then priority end asc,
          case when p_sort = 'recent' then created_at end desc,
          case when p_sort = 'name' then full_name end asc,
          case when p_sort = 'ending' then block_end end asc nulls last,
          case when p_sort = 'activity' then coalesce(last_active_at, last_login_at, updated_at) end desc nulls last,
          full_name asc
      ) as rn
    from filtered
  )
  select
    coalesce((select jsonb_agg(to_jsonb(o.*) - 'rn' - 'f_account_activated' - 'f_has_active_program' - 'flags' order by o.rn) from ordered o where o.rn > p_offset and o.rn <= p_offset + p_limit), '[]'::jsonb),
    coalesce((select count(*) from filtered), 0),
    coalesce((
      select jsonb_build_object(
        'all', count(*),
        'needs_setup', count(*) filter (where 'needs_setup' = any(flags)),
        'needs_review', count(*) filter (where 'needs_review' = any(flags)),
        'program_ending', count(*) filter (where 'program_ending' = any(flags)),
        'payment_issues', count(*) filter (where 'payment_issues' = any(flags)),
        'no_payment', count(*) filter (where 'no_payment' = any(flags)),
        'payment_pending', count(*) filter (where 'payment_pending' = any(flags)),
        'new_clients', count(*) filter (where 'new_clients' = any(flags)),
        'missed_workouts', count(*) filter (where 'missed_workouts' = any(flags)),
        'inactive', count(*) filter (where 'inactive' = any(flags)),
        'no_contract', count(*) filter (where 'no_contract' = any(flags)),
        'no_program', count(*) filter (where 'no_program' = any(flags)),
        'no_nutrition', count(*) filter (where 'no_nutrition' = any(flags)),
        'no_cardio', count(*) filter (where 'no_cardio' = any(flags))
      )
      from count_source
    ), jsonb_build_object('all', 0, 'needs_setup', 0, 'needs_review', 0, 'program_ending', 0, 'payment_issues', 0, 'no_payment', 0, 'payment_pending', 0, 'new_clients', 0, 'missed_workouts', 0, 'inactive', 0, 'no_contract', 0, 'no_program', 0, 'no_nutrition', 0, 'no_cardio', 0))
  into v_rows, v_total, v_counts;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'counts', v_counts
  );
end;
$function$;

revoke all on function public.admin_clients_directory(text, text, text, uuid, text, integer, integer, text, text[]) from public, anon;
grant execute on function public.admin_clients_directory(text, text, text, uuid, text, integer, integer, text, text[]) to authenticated, service_role;
