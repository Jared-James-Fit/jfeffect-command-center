-- Clients list: contract status on every client, and "what's missing" filters.
--
-- 1) coaching_agreement_client_status: for every client, whether they have signed the
--    Coaching Agreement. This is the same decision the app makes in TypeScript
--    (resolveAgreementState + rosterStatusOf in src/lib/coaching-agreement/rules.ts),
--    expressed in SQL so the clients list can show, filter and count it. A test keeps the two
--    in step. The "sign again below this version" line lives in one tiny function so raising
--    it later is a one-line migration, not a rewrite of the directory.
-- 2) admin_clients_directory:
--      * every row carries its contract status (coaching_agreement_*);
--      * p_flags: a list of filters; a client must match ALL of them. p_status still works
--        (it is folded into the list), so a browser tab still running the previous build keeps
--        working until it reloads;
--      * counts has one number per filter (over the current search / type / coach);
--      * the attention order puts an unsigned agreement after "no payment" and before
--        program gaps (priorities after it each moved down by one).
--
-- Adding a parameter makes a second overload, which PostgREST can't choose between, so the old
-- 8-argument version is dropped in the same transaction. Apply this BEFORE shipping the
-- matching app code; the previous app code keeps working against it.
--
-- Safe to re-run.

-- 1) contract status ----------------------------------------------------------------------
-- Keep equal to RESIGN_REQUIRED_BELOW_VERSION in src/lib/coaching-agreement/version.ts.
create or replace function public.coaching_agreement_resign_below_version()
returns text
language sql
immutable
as $$ select '2.0'::text $$;

revoke all on function public.coaching_agreement_resign_below_version() from public, anon, authenticated;
grant execute on function public.coaching_agreement_resign_below_version() to service_role;

create or replace view public.coaching_agreement_client_status
with (security_invoker = true) as
select
  c.id as client_id,
  case
    when st.exempt_kind is not null then 'exempt'
    when need.reason is null then 'signed'
    when c.user_id is null then 'no_account'
    else need.reason
  end as status,
  sg.signed_at,
  sg.version as signed_version,
  st.resign_requested_at,
  st.exempt_kind,
  st.last_reminded_at,
  coalesce(st.reminder_count, 0) as reminder_count
from public.clients c
left join public.coaching_agreement_client_state st on st.client_id = c.id
left join lateral (
  select s.id, s.signed_at, v.version
  from public.coaching_agreement_signatures s
  join public.coaching_agreement_versions v on v.id = s.version_id
  where s.client_id = c.id
  order by s.signed_at desc, s.created_at desc
  limit 1
) sg on true
cross join lateral (
  select
    case
      when sg.id is null then 'never_signed'
      when case
             when sg.version ~ '^[0-9]+(\.[0-9]+)*$'
               then string_to_array(sg.version, '.')::int[]
                    < string_to_array(public.coaching_agreement_resign_below_version(), '.')::int[]
             else true
           end then 'new_version'
      when st.resign_requested_at is not null and sg.signed_at < st.resign_requested_at then 'admin_request'
    end as reason
) need;

-- Read only through admin_clients_directory (which is security definer and checks who is
-- asking); nobody reads it directly. security_invoker means the view never uses its owner's
-- rights for whoever queries it, so a stray grant could not leak other clients' status.
revoke all on public.coaching_agreement_client_status from public, anon, authenticated;
grant select on public.coaching_agreement_client_status to service_role;

-- 2) directory ------------------------------------------------------------------------------
drop function if exists public.admin_clients_directory(text, text, text, uuid, text, integer, integer, text);

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
  pending_reviews as (
    select client_id, count(*) as n
    from public.submission_reviews
    where client_id in (select id from base)
      and coalesce(review_status,'') in ('pending','needs_review','submitted')
    group by client_id
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
