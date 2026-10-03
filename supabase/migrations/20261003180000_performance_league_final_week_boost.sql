-- ============================================================================
-- Performance League: Final Week Boost
-- ============================================================================
-- Fairness rule: athletes who finish the month with >= 90% of their
-- legitimately prescribed workouts completed have their WORKOUT-COMPLETION
-- points raised to the highest legitimate workout-completion total in the
-- league ("Workout Points Match"). Other categories are never matched.
--
-- Pieces (one source of truth — every surface reads league_month_scores):
--   league_tz / league_month_bounds   league month in the coaching timezone
--   league_prescription_snapshots     tamper-resistant ledger of prescribed
--                                     sessions per month (+ admin excusals)
--   capture_league_prescriptions      keeps the ledger current (cron 15 min)
--   league_month_scores               points, adherence, boost status,
--                                     projection, ceiling — per athlete
--   league_month_awards               month-end match awards (once, audited)
--   finalize_league_month             writes the awards (cron, idempotent)
--   get_performance_league            client leaderboard RPC
--   get_monthly_athlete_rankings      legacy RPC, now a thin wrapper
--   get_league_admin / league_excuse_session   staff tools
--
-- Ledger rules (anti-gaming):
--   * Eligible = client-visible, non-custom sessions in a non-archived block
--     whose effective date (rescheduled date wins) falls in the month.
--   * A session LOCKS once its date arrives, and every session locks at the
--     final-week freeze. Removing a locked session never reduces the
--     denominator; removing a not-yet-locked (future) session does — that's a
--     genuine coach programming change.
--   * Sessions first seen at/after the freeze (final-week additions) are
--     ignored for adherence, so adding easy sessions late can't qualify you.
--   * Moving a session within the month keeps it (same session id).
--   * Staff can excuse a specific session (injury etc.) with a reason; it's
--     recorded with who/when.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Timezone + month bounds
-- ---------------------------------------------------------------------------
create or replace function public.league_tz()
returns text language sql immutable as $$ select 'America/Winnipeg'::text $$;

-- Minimum prescribed workouts in a full month to be boost-eligible (prorated
-- for mid-month joiners). Stops a near-empty program (1-2 sessions) from
-- being matched to a full training month.
create or replace function public.league_min_prescribed()
returns integer language sql immutable as $$ select 6 $$;

-- First league month with a tamper-resistant ledger. Earlier months are never
-- finalized with a boost.
create or replace function public.league_boost_start_month()
returns date language sql immutable as $$ select date '2026-10-01' $$;

create or replace function public.league_month_bounds(_month date default null, _now timestamptz default now())
returns table(
  month_start date,
  month_end date,
  start_at timestamptz,
  end_at timestamptz,
  final_week_start date,
  freeze_at timestamptz,
  days_in_month integer
)
language sql stable set search_path to 'public' as $$
  with m as (
    select date_trunc('month', coalesce(_month, (_now at time zone public.league_tz())::date))::date ms
  )
  select
    m.ms,
    (m.ms + interval '1 month - 1 day')::date,
    (m.ms::timestamp at time zone public.league_tz()),
    ((m.ms + interval '1 month')::timestamp at time zone public.league_tz()),
    ((m.ms + interval '1 month')::date - 7),
    (((m.ms + interval '1 month')::date - 7)::timestamp at time zone public.league_tz()),
    extract(day from (m.ms + interval '1 month - 1 day'))::int
  from m
$$;

-- ---------------------------------------------------------------------------
-- Ledger of prescribed sessions
-- ---------------------------------------------------------------------------
create table if not exists public.league_prescription_snapshots (
  client_id uuid not null references public.clients(id) on delete cascade,
  league_month date not null,
  day_id uuid not null,
  scheduled_date date not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  locked_at timestamptz,
  removed_at timestamptz,
  excused_at timestamptz,
  excused_by uuid,
  excuse_reason text,
  primary key (client_id, league_month, day_id)
);
alter table public.league_prescription_snapshots enable row level security;
revoke all on public.league_prescription_snapshots from anon, authenticated;
grant all on public.league_prescription_snapshots to service_role;

-- Sessions currently prescribed for a month (live view of the programs).
create or replace function public.league_current_prescriptions(_month_start date, _month_end date)
returns table(client_id uuid, day_id uuid, scheduled_date date)
language sql stable security definer set search_path to 'public' as $$
  select b.client_id, d.id, coalesce(s.scheduled_date, d.scheduled_date)
  from public.pl_days d
  join public.pl_weeks w on w.id = d.week_id
  join public.pl_blocks b on b.id = w.block_id
  join public.clients c on c.id = b.client_id
  left join lateral (
    select ps.scheduled_date from public.pl_scheduled_workouts ps
    where ps.source_day_id = d.id order by ps.updated_at desc limit 1
  ) s on true
  where d.deleted_at is null and coalesce(d.archived,false) = false
    and coalesce(d.is_custom,false) = false
    and w.deleted_at is null and coalesce(w.archived,false) = false
    and coalesce(b.archived,false) = false and coalesce(b.client_visible,false) = true
    and coalesce(c.archived,false) = false and c.archived_at is null
    and coalesce(s.scheduled_date, d.scheduled_date) between _month_start and _month_end
$$;
revoke all on function public.league_current_prescriptions(date, date) from public, anon, authenticated;

create or replace function public.capture_league_prescriptions(_now timestamptz default now())
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  b record;
  local_today date := (_now at time zone public.league_tz())::date;
  touched integer := 0;
begin
  select * into b from public.league_month_bounds(null, _now);

  insert into public.league_prescription_snapshots as s
    (client_id, league_month, day_id, scheduled_date, first_seen_at, last_seen_at)
  select p.client_id, b.month_start, p.day_id, p.scheduled_date, _now, _now
  from public.league_current_prescriptions(b.month_start, b.month_end) p
  on conflict (client_id, league_month, day_id) do update
    set scheduled_date = excluded.scheduled_date,
        last_seen_at = excluded.last_seen_at,
        removed_at = null;
  get diagnostics touched = row_count;

  update public.league_prescription_snapshots s
  set removed_at = _now
  where s.league_month = b.month_start and s.removed_at is null
    and not exists (
      select 1 from public.league_current_prescriptions(b.month_start, b.month_end) p
      where p.client_id = s.client_id and p.day_id = s.day_id
    );

  update public.league_prescription_snapshots s
  set locked_at = _now
  where s.league_month = b.month_start and s.locked_at is null and s.removed_at is null
    and (s.scheduled_date <= local_today or _now >= b.freeze_at);

  return touched;
end;
$$;
revoke all on function public.capture_league_prescriptions(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Month-end awards
-- ---------------------------------------------------------------------------
create table if not exists public.league_month_awards (
  client_id uuid not null references public.clients(id) on delete cascade,
  league_month date not null,
  eligible_workouts integer not null,
  completed_workouts integer not null,
  adherence_pct numeric not null,
  qualified boolean not null,
  workout_points integer not null,
  ceiling_points integer not null,
  coverage numeric not null,
  match_points integer not null check (match_points >= 0),
  reason text not null,
  final_total integer not null,
  finalized_at timestamptz not null default now(),
  primary key (client_id, league_month)
);
alter table public.league_month_awards enable row level security;
revoke all on public.league_month_awards from anon, authenticated;
grant all on public.league_month_awards to service_role;

-- ---------------------------------------------------------------------------
-- Core: one row per active athlete for a league month
-- ---------------------------------------------------------------------------
create or replace function public.league_month_scores(_month date default null, _now timestamptz default now())
returns table(
  client_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  qualified boolean,
  bodyweight_value numeric,
  bodyweight_unit text,
  bodyweight_logged_at date,
  workouts_completed integer,
  fully_logged integer,
  bodyweight_logs integer,
  improved_exercises integer,
  workout_points integer,
  logging_points integer,
  bodyweight_points integer,
  improvement_points integer,
  base_total integer,
  match_points integer,
  total_points integer,
  rank integer,
  eligible_workouts integer,
  completed_eligible integer,
  adherence_pct numeric,
  needed_workouts integer,
  open_workouts integer,
  boost_possible boolean,
  boost_qualified boolean,
  legit_workout_points integer,
  ceiling_points integer,
  coverage numeric,
  match_target integer,
  projected_match integer,
  projected_total integer,
  boost_status text,
  boost_reason text,
  finalized boolean,
  month_start date,
  final_week_start date,
  is_final_week boolean,
  month_closed boolean
)
language sql stable security definer set search_path to 'public' as $function$
with bounds as (select * from public.league_month_bounds(_month, _now)),
flags as (
  select b.*,
    (_now >= b.end_at) month_closed,
    (_now >= b.freeze_at and _now < b.end_at) is_final_week,
    exists (select 1 from public.league_month_awards a where a.league_month = b.month_start) finalized
  from bounds b
),
base as (
  select c.id client_id, c.user_id,
    coalesce(nullif(trim(coalesce(c.first_name,'')||' '||left(coalesce(c.last_name,''),1)),''),split_part(coalesce(c.full_name,'Athlete'),' ',1)) display_name,
    p.avatar_url,
    (c.created_at at time zone public.league_tz())::date joined_on
  from public.clients c left join public.profiles p on p.id = c.user_id
  where coalesce(c.archived,false) = false and c.archived_at is null and coalesce(c.status,'') <> 'Archived'
),
bodyweight_sources as (
  select pb.user_id, pb.weight_value, pb.weight_unit, pb.logged_date, pb.created_at
  from public.progress_bodyweight pb where pb.weight_value is not null and pb.weight_value > 0
  union all
  select c.user_id, pm.bodyweight, coalesce(pm.bodyweight_unit,'lb'), pm.entry_date, pm.created_at
  from public.progress_metrics pm join public.clients c on c.id = pm.client_id
  where pm.bodyweight is not null and pm.bodyweight > 0
),
current_bw as (
  select distinct on (bs.user_id) bs.user_id, bs.weight_value, bs.weight_unit, bs.logged_date
  from bodyweight_sources bs order by bs.user_id, bs.logged_date desc, bs.created_at desc
),
-- Points earned this month. A session completed twice (legacy duplicate
-- completion rows) only ever scores once: count distinct sessions.
events as (
  select e.client_id, e.event_type, e.occurred_at, coalesce(dc.day_id, e.source_id) unit_id
  from public.athlete_xp_events e
  left join public.pl_day_completions dc on dc.id = e.source_id and e.event_type in ('workout_completed','workout_fully_logged')
  cross join flags f
  where e.occurred_at >= f.start_at and e.occurred_at < f.end_at and e.occurred_at <= _now
    and e.event_type in ('workout_completed','workout_fully_logged','bodyweight')
),
event_counts as (
  select ev.client_id,
    count(distinct ev.unit_id) filter (where ev.event_type = 'workout_completed')::int workouts_completed,
    count(distinct ev.unit_id) filter (where ev.event_type = 'workout_fully_logged')::int fully_logged,
    count(distinct (ev.occurred_at at time zone public.league_tz())::date) filter (where ev.event_type = 'bodyweight')::int bodyweight_logs
  from events ev group by ev.client_id
),
valid_sets as (
  select r.client_id, er.exercise_id, r.completed_at,
    (coalesce(r.normalized_kg, r.actual_load_kg,
      case when lower(coalesce(r.actual_load_unit, r.entered_unit)) = 'lb'
        then coalesce(r.actual_load, r.entered_value) * 0.45359237
        else coalesce(r.actual_load, r.entered_value) end)
      * 36.0 / (37.0 - r.actual_reps)) e1rm_kg
  from public.pl_row_results r join public.pl_exercise_rows er on er.id = r.row_id
  where er.exercise_id is not null and coalesce(r.is_working_set,true) = true
    and coalesce(r.load_type,'external') = 'external' and r.actual_reps between 1 and 12
    and r.completed_at is not null and r.completed_at <= _now
    and coalesce(r.normalized_kg, r.actual_load_kg, r.actual_load, r.entered_value) > 0
),
improvements as (
  select cur.client_id, count(*)::int improved_exercises
  from (select s.client_id, s.exercise_id, max(s.e1rm_kg) e1rm from valid_sets s, flags f
        where s.completed_at >= f.start_at and s.completed_at < f.end_at group by 1,2) cur
  join (select s.client_id, s.exercise_id, max(s.e1rm_kg) e1rm from valid_sets s, flags f
        where s.completed_at < f.start_at group by 1,2) pri using (client_id, exercise_id)
  where pri.e1rm > 0 and cur.e1rm > pri.e1rm + 0.05
  group by cur.client_id
),
-- Adherence ledger for the month.
ledger as (
  select s.client_id, s.day_id,
    (s.excused_at is not null) excused,
    (s.removed_at is not null) removed,
    exists (
      select 1 from public.pl_day_completions dc
      where dc.day_id = s.day_id and dc.client_id = s.client_id
        and dc.completed_at is not null and dc.completed_at < f.end_at and dc.completed_at <= _now
    ) done,
    exists (
      select 1 from public.pl_day_completions dc
      where dc.day_id = s.day_id and dc.client_id = s.client_id
        and dc.completed_at >= f.start_at and dc.completed_at < f.end_at and dc.completed_at <= _now
    ) done_in_month
  from public.league_prescription_snapshots s cross join flags f
  where s.league_month = f.month_start
    and s.first_seen_at < f.freeze_at
    and (s.removed_at is null or (s.locked_at is not null and s.locked_at <= s.removed_at))
),
adherence as (
  select l.client_id,
    count(*) filter (where not l.excused or l.done)::int eligible_workouts,
    count(*) filter (where l.done)::int completed_eligible,
    count(*) filter (where l.done_in_month)::int legit_completed,
    -- Still completable this month: not done, not excused, still on the program.
    count(*) filter (where not l.done and not l.excused and not l.removed)::int open_workouts
  from ledger l group by l.client_id
),
assembled as (
  select b.client_id, b.user_id, b.display_name, b.avatar_url, b.joined_on,
    (cb.logged_date is not null) qualified,
    cb.weight_value, cb.weight_unit, cb.logged_date,
    coalesce(ec.workouts_completed,0) workouts_completed,
    coalesce(ec.fully_logged,0) fully_logged,
    coalesce(ec.bodyweight_logs,0) bodyweight_logs,
    coalesce(i.improved_exercises,0) improved_exercises,
    coalesce(a.eligible_workouts,0) eligible_workouts,
    coalesce(a.completed_eligible,0) completed_eligible,
    coalesce(a.legit_completed,0) legit_completed,
    coalesce(a.open_workouts,0) open_workouts
  from base b
  left join current_bw cb on cb.user_id = b.user_id
  left join event_counts ec on ec.client_id = b.client_id
  left join improvements i on i.client_id = b.client_id
  left join adherence a on a.client_id = b.client_id
),
pointed as (
  select x.*,
    x.workouts_completed * 10 workout_points,
    x.fully_logged * 5 logging_points,
    x.bodyweight_logs * 5 bodyweight_points,
    x.improved_exercises * 5 improvement_points,
    least(x.workouts_completed, x.legit_completed) * 10 legit_workout_points,
    -- 90% target, integer math: ceil(eligible * 0.9)
    greatest(0, (x.eligible_workouts * 9 + 9) / 10 - x.completed_eligible) needed_workouts
  from assembled x
),
ceiling as (
  -- Highest legitimate workout total among athletes on the board.
  select coalesce(max(p.legit_workout_points) filter (where p.qualified), 0) ceiling_points from pointed p
),
boosted as (
  select p.*, c.ceiling_points, f.*,
    case when p.joined_on > f.month_start
      then round(greatest(0, f.month_end - p.joined_on + 1)::numeric / f.days_in_month, 4)
      else 1::numeric end coverage,
    greatest(1, ceil(public.league_min_prescribed() *
      case when p.joined_on > f.month_start
        then greatest(0, f.month_end - p.joined_on + 1)::numeric / f.days_in_month else 1 end))::int min_prescribed
  from pointed p cross join ceiling c cross join flags f
),
eligibility as (
  select bo.*,
    (bo.eligible_workouts >= bo.min_prescribed and bo.needed_workouts = 0) boost_qualified,
    (bo.eligible_workouts >= bo.min_prescribed and bo.needed_workouts = 0)
      or (bo.eligible_workouts >= bo.min_prescribed and not bo.month_closed and bo.needed_workouts <= bo.open_workouts) boost_possible
  from boosted bo
),
targeted as (
  select bo.*,
    -- Mid-month joiners match a prorated ceiling (whole multiple of 5).
    (floor(bo.ceiling_points * bo.coverage / 5) * 5)::int match_target,
    bo.workout_points + bo.logging_points + bo.bodyweight_points + bo.improvement_points base_total
  from eligibility bo
),
finalized_awards as (
  select a.client_id, a.match_points from public.league_month_awards a, flags f where a.league_month = f.month_start
),
final as (
  select t.*,
    coalesce(fa.match_points, 0) awarded_match,
    case when t.boost_possible
      then greatest(0, t.match_target - (t.workout_points + 10 * t.needed_workouts)) else 0 end projected_match
  from targeted t left join finalized_awards fa on fa.client_id = t.client_id
),
scored as (
  select fi.*,
    fi.base_total + fi.awarded_match total_points,
    case when fi.boost_possible
      then fi.base_total + 10 * fi.needed_workouts + fi.projected_match end projected_total,
    case
      when fi.eligible_workouts < fi.min_prescribed then 'none'
      when fi.boost_qualified then 'ready'
      when not fi.boost_possible then 'out'
      else 'chasing' end boost_status,
    case
      when fi.eligible_workouts = 0 then 'No prescribed workouts recorded for this month'
      when fi.eligible_workouts < fi.min_prescribed then 'Fewer than ' || fi.min_prescribed || ' prescribed workouts this month'
      when fi.boost_qualified and fi.workout_points >= fi.match_target then 'Qualified — already at or above the highest workout points'
      when fi.boost_qualified then 'Qualified — 90%+ of prescribed workouts completed'
      when not fi.boost_possible and fi.month_closed then 'Finished below 90% of prescribed workouts'
      when not fi.boost_possible then 'Can no longer reach 90% this month'
      else 'Needs ' || fi.needed_workouts || ' more prescribed workout' || case when fi.needed_workouts = 1 then '' else 's' end end boost_reason
  from final fi
)
select s.client_id, s.user_id, s.display_name, s.avatar_url, s.qualified,
  s.weight_value, s.weight_unit, s.logged_date,
  s.workouts_completed, s.fully_logged, s.bodyweight_logs, s.improved_exercises,
  s.workout_points, s.logging_points, s.bodyweight_points, s.improvement_points,
  s.base_total, s.awarded_match, s.total_points,
  (case when s.qualified then row_number() over (
      partition by s.qualified
      order by s.total_points desc, s.improvement_points desc, s.workout_points desc,
               s.logging_points desc, s.bodyweight_points desc, s.display_name, s.client_id) end)::int,
  s.eligible_workouts, s.completed_eligible,
  case when s.eligible_workouts > 0 then round(100.0 * s.completed_eligible / s.eligible_workouts, 1) else 0 end,
  s.needed_workouts, s.open_workouts, s.boost_possible, s.boost_qualified,
  s.legit_workout_points, s.ceiling_points, s.coverage, s.match_target,
  s.projected_match, s.projected_total, s.boost_status, s.boost_reason,
  s.finalized, s.month_start, s.final_week_start, s.is_final_week, s.month_closed
from scored s
$function$;
revoke all on function public.league_month_scores(date, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Month-end finalization (idempotent; awards are never written twice and
-- never negative). Runs for the previous month once it has closed.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_league_month(_month date default null, _now timestamptz default now())
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  target date := coalesce(_month, (date_trunc('month', (_now at time zone public.league_tz())::date) - interval '1 month')::date);
  b record;
  written integer := 0;
begin
  select * into b from public.league_month_bounds(target, _now);
  if _now < b.end_at then
    raise exception 'League month % has not ended yet', b.month_start;
  end if;
  if b.month_start < public.league_boost_start_month() then
    return 0;
  end if;
  if exists (select 1 from public.league_month_awards where league_month = b.month_start) then
    return 0;
  end if;

  insert into public.league_month_awards (
    client_id, league_month, eligible_workouts, completed_workouts, adherence_pct, qualified,
    workout_points, ceiling_points, coverage, match_points, reason, final_total, finalized_at)
  select s.client_id, b.month_start, s.eligible_workouts, s.completed_eligible, s.adherence_pct, s.boost_qualified,
    s.workout_points, s.ceiling_points, s.coverage,
    case when s.boost_qualified then greatest(0, s.match_target - s.workout_points) else 0 end,
    s.boost_reason,
    s.base_total + case when s.boost_qualified then greatest(0, s.match_target - s.workout_points) else 0 end,
    _now
  from public.league_month_scores(b.month_start, b.end_at) s
  where s.eligible_workouts > 0 or s.base_total > 0
  on conflict (client_id, league_month) do nothing;
  get diagnostics written = row_count;
  return written;
end;
$$;
revoke all on function public.finalize_league_month(date, timestamptz) from public, anon, authenticated;

create or replace function public.run_league_automation()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  captured integer;
  finalized integer := 0;
  prev date := (date_trunc('month', (now() at time zone public.league_tz())::date) - interval '1 month')::date;
begin
  captured := public.capture_league_prescriptions(now());
  if prev >= public.league_boost_start_month()
     and not exists (select 1 from public.league_month_awards where league_month = prev) then
    finalized := public.finalize_league_month(prev, now());
  end if;
  return jsonb_build_object('captured', captured, 'finalized', finalized);
end;
$$;
revoke all on function public.run_league_automation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Client RPC: leaderboard + boost data (top 50 qualified + me)
-- ---------------------------------------------------------------------------
create or replace function public.get_performance_league(_month date default null)
returns table(
  client_id uuid, display_name text, avatar_url text, rank integer, is_me boolean, qualified boolean,
  bodyweight_value numeric, bodyweight_unit text,
  total_points integer, workout_points integer, logging_points integer, bodyweight_points integer,
  improvement_points integer, match_points integer,
  workouts_completed integer, fully_logged integer,
  boost_status text, needed_workouts integer, projected_total integer,
  eligible_workouts integer, completed_eligible integer, adherence_pct numeric, open_workouts integer,
  match_target integer, projected_match integer,
  month_start date, final_week_start date, is_final_week boolean, month_closed boolean, finalized boolean
)
language sql stable security definer set search_path to 'public' as $$
  select s.client_id, s.display_name, s.avatar_url, s.rank, (s.user_id = auth.uid()), s.qualified,
    s.bodyweight_value, s.bodyweight_unit,
    s.total_points, s.workout_points, s.logging_points, s.bodyweight_points, s.improvement_points, s.match_points,
    s.workouts_completed, s.fully_logged,
    s.boost_status, s.needed_workouts, s.projected_total,
    -- Exact adherence numbers are private to the athlete themselves.
    case when s.user_id = auth.uid() then s.eligible_workouts end,
    case when s.user_id = auth.uid() then s.completed_eligible end,
    case when s.user_id = auth.uid() then s.adherence_pct end,
    case when s.user_id = auth.uid() then s.open_workouts end,
    case when s.user_id = auth.uid() then s.match_target end,
    case when s.user_id = auth.uid() then s.projected_match end,
    s.month_start, s.final_week_start, s.is_final_week, s.month_closed, s.finalized
  from public.league_month_scores(_month, now()) s
  where auth.uid() is not null
    and ((s.qualified and s.rank <= 50) or s.user_id = auth.uid())
  order by s.qualified desc, s.rank nulls last, s.display_name
$$;
revoke all on function public.get_performance_league(date) from public, anon;
grant execute on function public.get_performance_league(date) to authenticated, service_role;

-- Legacy RPC (home card): same numbers, same shape as before.
create or replace function public.get_monthly_athlete_rankings(_limit integer default 15)
returns table(
  client_id uuid, display_name text, avatar_url text, monthly_xp bigint, rank bigint, is_me boolean,
  bodyweight_value numeric, bodyweight_unit text, bodyweight_logged_at date,
  workouts_completed bigint, fully_logged bigint, strength_score bigint, qualified boolean
)
language sql stable security definer set search_path to 'public' as $$
  select s.client_id, s.display_name, s.avatar_url, (s.total_points * 1000)::bigint, s.rank::bigint,
    (s.user_id = auth.uid()), s.bodyweight_value, s.bodyweight_unit, s.bodyweight_logged_at,
    s.workouts_completed::bigint, s.fully_logged::bigint, (s.improvement_points * 1000)::bigint, s.qualified
  from public.league_month_scores(null, now()) s
  where auth.uid() is not null
    and ((s.qualified and s.rank <= least(greatest(_limit,1),50)) or s.user_id = auth.uid())
  order by s.qualified desc, s.rank nulls last, s.display_name
$$;

-- ---------------------------------------------------------------------------
-- Staff tools
-- ---------------------------------------------------------------------------
create or replace function public.league_is_staff()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is not null and (
    public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'coach'::public.app_role))
$$;

create or replace function public.get_league_admin(_month date default null)
returns table(
  client_id uuid, display_name text, qualified_for_board boolean, rank integer, total_points integer,
  workout_points integer, legit_workout_points integer, logging_points integer, bodyweight_points integer, improvement_points integer,
  eligible_workouts integer, completed_eligible integer, adherence_pct numeric, needed_workouts integer, open_workouts integer,
  boost_status text, boost_possible boolean, boost_qualified boolean, boost_reason text,
  ceiling_points integer, coverage numeric, match_target integer, projected_match integer, projected_total integer,
  awarded_match integer, awarded_at timestamptz, award_reason text,
  month_start date, is_final_week boolean, month_closed boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.league_is_staff() then raise exception 'Staff access required'; end if;
  return query
  select s.client_id, s.display_name, s.qualified, s.rank, s.total_points,
    s.workout_points, s.legit_workout_points, s.logging_points, s.bodyweight_points, s.improvement_points,
    s.eligible_workouts, s.completed_eligible, s.adherence_pct, s.needed_workouts, s.open_workouts,
    s.boost_status, s.boost_possible, s.boost_qualified, s.boost_reason,
    s.ceiling_points, s.coverage, s.match_target, s.projected_match, s.projected_total,
    a.match_points, a.finalized_at, a.reason,
    s.month_start, s.is_final_week, s.month_closed
  from public.league_month_scores(_month, now()) s
  left join public.league_month_awards a on a.client_id = s.client_id and a.league_month = s.month_start
  where s.eligible_workouts > 0 or s.base_total > 0 or s.qualified
  order by s.rank nulls last, s.display_name;
end;
$$;
revoke all on function public.get_league_admin(date) from public, anon;
grant execute on function public.get_league_admin(date) to authenticated, service_role;

create or replace function public.get_league_admin_sessions(_client_id uuid, _month date default null)
returns table(day_id uuid, scheduled_date date, title text, counted boolean, done boolean, locked_at timestamptz,
  removed_at timestamptz, first_seen_at timestamptz, excused_at timestamptz, excuse_reason text, note text)
language plpgsql stable security definer set search_path to 'public' as $$
declare b record;
begin
  if not public.league_is_staff() then raise exception 'Staff access required'; end if;
  select * into b from public.league_month_bounds(_month, now());
  return query
  select s.day_id, s.scheduled_date, d.title,
    (s.first_seen_at < b.freeze_at and (s.removed_at is null or (s.locked_at is not null and s.locked_at <= s.removed_at))) counted,
    exists (select 1 from public.pl_day_completions dc where dc.day_id = s.day_id and dc.client_id = s.client_id
            and dc.completed_at is not null and dc.completed_at < b.end_at) done,
    s.locked_at, s.removed_at, s.first_seen_at, s.excused_at, s.excuse_reason,
    case
      when s.first_seen_at >= b.freeze_at then 'Added during final week — not counted'
      when s.removed_at is not null and (s.locked_at is null or s.locked_at > s.removed_at) then 'Removed before it was due — not counted'
      when s.removed_at is not null then 'Removed after it was due — still counted'
      when s.excused_at is not null then 'Excused'
      else null end
  from public.league_prescription_snapshots s
  left join public.pl_days d on d.id = s.day_id
  where s.client_id = _client_id and s.league_month = b.month_start
  order by s.scheduled_date, d.title;
end;
$$;
revoke all on function public.get_league_admin_sessions(uuid, date) from public, anon;
grant execute on function public.get_league_admin_sessions(uuid, date) to authenticated, service_role;

create or replace function public.league_excuse_session(_client_id uuid, _day_id uuid, _reason text, _month date default null, _excuse boolean default true)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare b record;
begin
  if not public.league_is_staff() then raise exception 'Staff access required'; end if;
  select * into b from public.league_month_bounds(_month, now());
  if exists (select 1 from public.league_month_awards where league_month = b.month_start) then
    raise exception 'This league month is already finalized';
  end if;
  if _excuse and coalesce(trim(_reason),'') = '' then raise exception 'A reason is required'; end if;
  update public.league_prescription_snapshots
  set excused_at = case when _excuse then now() end,
      excused_by = case when _excuse then auth.uid() end,
      excuse_reason = case when _excuse then trim(_reason) end
  where client_id = _client_id and day_id = _day_id and league_month = b.month_start;
  if not found then raise exception 'Session not found in this league month'; end if;
end;
$$;
revoke all on function public.league_excuse_session(uuid, uuid, text, date, boolean) from public, anon;
grant execute on function public.league_excuse_session(uuid, uuid, text, date, boolean) to authenticated, service_role;

-- Profile month counts follow the league month (coaching timezone).
create or replace function public.get_athlete_public_profile(_client_id uuid)
returns table(
  client_id uuid, display_name text, avatar_url text, xp bigint, workouts_completed bigint,
  workouts_fully_logged bigint, first_workout_at timestamptz, is_me boolean,
  month_workouts_completed bigint, month_workouts_fully_logged bigint, last_workout_at timestamptz
)
language sql stable security definer set search_path to 'public' as $$
  select c.id,
    coalesce(nullif(trim(coalesce(c.first_name,'') || ' ' || left(coalesce(c.last_name,''),1)), ''), split_part(coalesce(c.full_name,'Athlete'),' ',1)),
    p.avatar_url,
    coalesce(sum(e.xp),0)::bigint,
    count(*) filter (where e.event_type = 'workout_completed'),
    count(*) filter (where e.event_type = 'workout_fully_logged'),
    min(e.occurred_at) filter (where e.event_type = 'workout_completed'),
    (c.user_id = auth.uid()),
    (select ms.workouts_completed from public.league_month_scores(null, now()) ms where ms.client_id = c.id)::bigint,
    (select ms.fully_logged from public.league_month_scores(null, now()) ms where ms.client_id = c.id)::bigint,
    max(e.occurred_at) filter (where e.event_type = 'workout_completed')
  from public.clients c
  left join public.profiles p on p.id = c.user_id
  left join public.athlete_xp_events e on e.client_id = c.id
  where auth.uid() is not null and c.id = _client_id
    and (c.user_id = auth.uid() or (coalesce(c.archived,false) = false and c.archived_at is null and coalesce(c.status,'') <> 'Archived'))
  group by c.id, p.avatar_url;
$$;

-- ---------------------------------------------------------------------------
-- Schedule: capture every 15 minutes, finalize the previous month once.
-- ---------------------------------------------------------------------------
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'performance-league-automation' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('performance-league-automation', '*/15 * * * *', 'select public.run_league_automation();');
exception when undefined_table or undefined_function then null;
end $$;

-- Start the ledger now.
select public.capture_league_prescriptions(now());
