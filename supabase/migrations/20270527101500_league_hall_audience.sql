-- League and Hall of Strength: two audiences, JF Effect Athletes and Community.
--
-- The coach asked for both boards to show either only his active coaching
-- clients ("JF Effect Athletes", the default in the app) or everyone who is
-- eligible today ("Community": coaching clients and members, the board as it
-- has always been). Eligibility is automatic from the account, never a list
-- anyone manages: JF Effect Athletes is `clients.service_tier = 'coaching'`
-- and not archived (deactivating archives; Deactivated / Deleted / Archived
-- statuses are left out too).
--
-- Every board function gets a trailing `_audience text DEFAULT 'community'`
-- ('coaching' or 'community'; anything else reads as community), so an older
-- app that doesn't send it reads exactly the board it always did. Nothing is
-- scored again: the audience only chooses who is on the board, and ranks and
-- counts are worked out among those people in the same order:
--   * get_performance_league: league_month_scores' own order, renumbered
--     among the audience (the points, boost and match columns are unchanged);
--   * movement and the Monday card: read the same weekly snapshots, taken
--     once for everyone (league_week_snapshots is untouched, no second job),
--     filtered to the audience and renumbered in their snapshot order
--     (league_week_audience_rows), so a climb is a climb within that audience;
--   * get_strength_board_all / _meets / _roster: the candidates are filtered
--     before anything is ranked, so every rank and count (men, women, all,
--     pound for pound) is among the audience, and "not ranked yet" lists only
--     them. Community is unchanged (alumni and meet athletes included).
-- The audience follows whoever is on the board *now* (current tier and
-- archive state), so a member who moves to coaching appears on JF Effect
-- Athletes with this month's points and last Monday's snapshot rows.
-- Return types of the replaced functions don't change; the old signatures
-- are dropped so a call without the new argument doesn't become ambiguous.

begin;

set local lock_timeout = '5s';

-- true when the audience means everyone (the default); only 'coaching' narrows
create or replace function public.league_audience_is_all(_audience text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$ select _audience is distinct from 'coaching' $$;

-- Is this athlete on that audience's boards? Everyone is on Community; JF Effect
-- Athletes is active coaching clients.
create or replace function public.league_in_audience(_client uuid, _audience text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select _audience is distinct from 'coaching'
    or exists (
      select 1 from public.clients c
       where c.id = _client
         and c.service_tier = 'coaching'
         and coalesce(c.archived, false) = false
         and c.archived_at is null
         and coalesce(c.status, '') not in ('Archived', 'Deactivated', 'Deleted')
    )
$$;
revoke all on function public.league_in_audience(uuid, text) from public, anon, authenticated;
grant execute on function public.league_in_audience(uuid, text) to service_role;

-- One Monday's snapshot rows for an audience, ranks renumbered among them (the
-- snapshot's own order). Community returns the rows as they were taken.
create or replace function public.league_week_audience_rows(_week date, _audience text)
returns setof public.league_week_snapshots
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.week_start, s.month_start, s.client_id, s.user_id, s.display_name, s.avatar_url, s.qualified,
    (case when public.league_audience_is_all(_audience) then s.rank
          when s.qualified and s.rank is not null then row_number() over (
            partition by (s.qualified and s.rank is not null) order by s.rank, s.client_id) end)::int,
    s.total_points, s.workouts_completed, s.fully_logged, s.bodyweight_logs, s.atpr_lifts, s.record_lifts,
    s.community_posts, s.taken_at
  from public.league_week_snapshots s
  where s.week_start = _week
    and (public.league_audience_is_all(_audience) or public.league_in_audience(s.client_id, _audience))
$$;
revoke all on function public.league_week_audience_rows(date, text) from public, anon, authenticated;
grant execute on function public.league_week_audience_rows(date, text) to service_role;

-- ── Hall of Strength: All-time bests ──
drop function if exists public.get_strength_board_all(uuid);
drop function if exists public.get_strength_board_all(uuid, text);

create function public.get_strength_board_all(_as_user uuid default null, _audience text default 'community')
returns table(
  person text,
  client_id uuid,
  athlete_id uuid,
  display_name text,
  avatar_url text,
  is_me boolean,
  is_coach boolean,
  is_alumni boolean,
  sex text,
  lift text,
  kg numeric,
  reps integer,
  source text,
  lifted_on date,
  meet_name text,
  federation text,
  bw_kg numeric,
  bw_multiple numeric,
  abs_rank integer,
  p4p_rank integer,
  all_rank integer,
  abs_count integer,
  p4p_count integer,
  all_count integer,
  squat_kg numeric,
  bench_kg numeric,
  deadlift_kg numeric,
  squat_reps integer,
  bench_reps integer,
  deadlift_reps integer,
  gl_points numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with viewer as (select public.portal_viewer_uid(_as_user) uid),
  valid as (
    select s.* from public.strength_board_sets() s
    where coalesce(s.review, '') <> 'excluded' and (s.flag is null or s.review = 'approved')
  ),
  best as (
    select distinct on (v.client_id, v.lift) v.client_id, v.lift, v.load_kg kg, v.reps, v.lift_day, v.bw_kg
    from valid v
    order by v.client_id, v.lift, v.load_kg desc, v.reps desc, v.lifted_at
  ),
  training as (
    select 'c:' || b.client_id person, b.lift, b.kg, b.reps, b.lift_day d, b.bw_kg, 'training'::text source,
      null::text meet_name, null::text federation, b.client_id::text || b.lift cand,
      null::numeric squat_kg, null::numeric bench_kg, null::numeric deadlift_kg,
      null::int squat_reps, null::int bench_reps, null::int deadlift_reps, null::numeric gl_points
    from best b
    union all
    select 'c:' || b.client_id, 'total', sum(b.kg), null::int, max(b.lift_day),
      case when count(b.bw_kg) = 3 then max(b.bw_kg) end, 'training', null, null, b.client_id::text || 'total',
      max(b.kg) filter (where b.lift = 'squat'), max(b.kg) filter (where b.lift = 'bench'), max(b.kg) filter (where b.lift = 'deadlift'),
      max(b.reps) filter (where b.lift = 'squat'), max(b.reps) filter (where b.lift = 'bench'), max(b.reps) filter (where b.lift = 'deadlift'),
      null::numeric
    from best b
    group by b.client_id
    having count(*) = 3
  ),
  meet_athletes as materialized (
    select a.id, a.client_id, a.athlete_name, a.sex, lower(coalesce(a.status, 'active')) = 'retired' retired,
      case when a.client_id is not null then 'c:' || a.client_id else 'a:' || a.id end person
    from public.powerlifting_athletes a
  ),
  meets as (
    select ma.person, l.lift, l.kg, null::int reps, l.meet_date d, l.bw_kg, 'meet'::text source,
      l.meet_name, l.federation, l.result_id::text || l.lift cand,
      r.squat_kg, r.bench_kg, r.deadlift_kg, null::int, null::int, null::int,
      case when l.lift = 'total' then l.gl_points end
    from public.strength_board_meet_lifts() l
    join meet_athletes ma on ma.id = l.athlete_id
    left join public.athlete_powerlifting_results r on r.id = l.result_id and l.lift = 'total'
  ),
  cands as materialized (
    select * from (
      select * from training
      union all
      select * from meets
    ) u
    -- JF Effect Athletes: only active coaching clients (their training and their meets); every rank and count below follows
    where public.league_audience_is_all(_audience)
      or (u.person like 'c:%' and public.league_in_audience(substr(u.person, 3)::uuid, _audience))
  ),
  people as materialized (
    select p.person, c.id client_id, ma.id athlete_id, c.user_id,
      case when c.id is not null then
        coalesce(nullif(trim(trim(coalesce(c.first_name, '')) || ' ' || left(trim(coalesce(c.last_name, '')), 1)), ''),
          split_part(coalesce(c.full_name, 'Athlete'), ' ', 1))
      else
        trim(split_part(trim(ma.athlete_name), ' ', 1) || ' ' || left(regexp_replace(trim(ma.athlete_name), '^.*\s', ''), 1))
      end display_name,
      public.community_avatar(pr.id) AS avatar_url,
      case when c.id is not null
        then coalesce(c.archived, false) or c.archived_at is not null or coalesce(c.status, '') = 'Archived'
        else coalesce(ma.retired, false) end is_alumni,
      case
        when lower(coalesce(c.sex, ma.sex, pa.sex, '')) like 'f%' then 'female'
        when lower(coalesce(c.sex, ma.sex, pa.sex, '')) like 'm%' then 'male'
      end sex
    from (select distinct person from cands) p
    left join public.clients c on c.id = case when p.person like 'c:%' then substr(p.person, 3)::uuid end
    left join lateral (
      select m.* from meet_athletes m where m.person = p.person order by (m.client_id is not null) desc limit 1
    ) ma on true
    left join lateral (
      select a.sex from public.powerlifting_athletes a where a.client_id = c.id order by a.created_at limit 1
    ) pa on true
    left join public.profiles pr on pr.id = c.user_id
  ),
  abs_best as (
    select distinct on (x.person, x.lift) x.person, x.lift, x.cand
    from cands x
    order by x.person, x.lift, x.kg desc, (x.source = 'meet') desc, x.d
  ),
  p4p_best as (
    select distinct on (x.person, x.lift) x.person, x.lift, x.cand, x.kg / x.bw_kg ratio
    from cands x
    where x.bw_kg is not null
    order by x.person, x.lift, x.kg / x.bw_kg desc, x.kg desc, (x.source = 'meet') desc, x.d
  ),
  abs_ranked as (
    select b.person, b.lift, b.cand,
      (row_number() over (partition by b.lift order by x.kg desc, (x.source = 'meet') desc, x.d))::int all_rank,
      (count(*) over (partition by b.lift))::int all_count,
      case when pe.sex is not null then (row_number() over (
        partition by b.lift, pe.sex is not null, pe.sex order by x.kg desc, (x.source = 'meet') desc, x.d))::int end abs_rank,
      case when pe.sex is not null then (count(*) over (partition by b.lift, pe.sex is not null, pe.sex))::int end abs_count
    from abs_best b
    join cands x on x.cand = b.cand
    join people pe on pe.person = b.person
  ),
  p4p_ranked as (
    select b.person, b.lift, b.cand,
      (row_number() over (partition by b.lift order by b.ratio desc, x.kg desc, (x.source = 'meet') desc, x.d))::int p4p_rank,
      (count(*) over (partition by b.lift))::int p4p_count
    from p4p_best b
    join cands x on x.cand = b.cand
  ),
  picked as (
    select coalesce(ar.person, pr.person) person, coalesce(ar.lift, pr.lift) lift, coalesce(ar.cand, pr.cand) cand,
      ar.abs_rank, pr.p4p_rank, ar.all_rank, ar.abs_count, pr.p4p_count, ar.all_count
    from abs_ranked ar
    full join p4p_ranked pr on pr.person = ar.person and pr.lift = ar.lift and pr.cand = ar.cand
  )
  select pe.person, pe.client_id, pe.athlete_id, pe.display_name, pe.avatar_url,
    coalesce(pe.user_id = v.uid, false), coalesce(public.community_is_coach(pe.user_id), false), pe.is_alumni,
    pe.sex, p.lift, round(x.kg, 1), x.reps, x.source, x.d, x.meet_name, x.federation,
    round(x.bw_kg, 1), round(x.kg / x.bw_kg, 2),
    p.abs_rank, p.p4p_rank, p.all_rank,
    max(p.abs_count) over (partition by p.lift, pe.sex), max(p.p4p_count) over (partition by p.lift), max(p.all_count) over (partition by p.lift),
    round(x.squat_kg, 1), round(x.bench_kg, 1), round(x.deadlift_kg, 1),
    x.squat_reps, x.bench_reps, x.deadlift_reps, round(x.gl_points, 2)
  from picked p
  join cands x on x.cand = p.cand
  join people pe on pe.person = p.person
  cross join viewer v
  where v.uid is not null
  order by p.lift, p.all_rank nulls last, p.p4p_rank
$function$;

revoke all on function public.get_strength_board_all(uuid, text) from public, anon;
grant execute on function public.get_strength_board_all(uuid, text) to authenticated, service_role;


-- ── Hall of Strength: Competition ──
drop function if exists public.get_strength_board_meets(uuid);
drop function if exists public.get_strength_board_meets(uuid, text);

create function public.get_strength_board_meets(_as_user uuid default null, _audience text default 'community')
returns table(
  athlete_id uuid,
  client_id uuid,
  display_name text,
  competed_as text,
  avatar_url text,
  is_me boolean,
  is_coach boolean,
  is_alumni boolean,
  sex text,
  lift text,
  kg numeric,
  meet_date date,
  meet_name text,
  federation text,
  weight_class text,
  bw_kg numeric,
  bw_multiple numeric,
  gl_points numeric,
  abs_rank integer,
  p4p_rank integer,
  all_rank integer,
  abs_count integer,
  p4p_count integer,
  all_count integer,
  athlete_meets integer,
  first_meet date,
  squat_kg numeric,
  bench_kg numeric,
  deadlift_kg numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with viewer as (select public.portal_viewer_uid(_as_user) uid),
  lifts as materialized (
    select l.result_id id, l.* from public.strength_board_meet_lifts() l
    -- JF Effect Athletes: only meets of active coaching clients (ranks and counts follow)
    where public.league_audience_is_all(_audience)
      or l.athlete_id in (
        select a.id from public.powerlifting_athletes a
        where a.client_id is not null and public.league_in_audience(a.client_id, _audience))
  ),
  athletes as materialized (
    select a.id athlete_id, c.id client_id, c.user_id,
      coalesce(nullif(regexp_replace(trim(coalesce(c.full_name, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')))), '\s+', ' ', 'g'), ''),
        a.athlete_name) display_name,
      a.athlete_name,
      public.community_avatar(pr.id) AS avatar_url,
      lower(coalesce(a.status, 'active')) = 'retired' is_alumni,
      case
        when lower(coalesce(a.sex, c.sex, '')) like 'f%' then 'female'
        when lower(coalesce(a.sex, c.sex, '')) like 'm%' then 'male'
      end sex,
      (select count(distinct l.id) from lifts l where l.athlete_id = a.id)::int athlete_meets,
      (select min(l.meet_date) from lifts l where l.athlete_id = a.id) first_meet
    from public.powerlifting_athletes a
    left join public.clients c on c.id = a.client_id
    left join public.profiles pr on pr.id = c.user_id
  ),
  abs_best as (
    select distinct on (l.athlete_id, l.lift) l.athlete_id, l.lift, l.id
    from lifts l
    order by l.athlete_id, l.lift, l.kg desc, l.meet_date
  ),
  p4p_best as (
    select distinct on (l.athlete_id, l.lift) l.athlete_id, l.lift, l.id, l.kg / l.bw_kg ratio
    from lifts l
    where l.bw_kg is not null
    order by l.athlete_id, l.lift, l.kg / l.bw_kg desc, l.kg desc, l.meet_date
  ),
  abs_ranked as (
    select b.athlete_id, b.lift, b.id,
      (row_number() over (partition by b.lift order by l.kg desc, l.meet_date))::int all_rank,
      (count(*) over (partition by b.lift))::int all_count,
      case when a.sex is not null then (row_number() over (
        partition by b.lift, a.sex is not null, a.sex order by l.kg desc, l.meet_date))::int end abs_rank,
      case when a.sex is not null then (count(*) over (partition by b.lift, a.sex is not null, a.sex))::int end abs_count
    from abs_best b
    join lifts l on l.id = b.id and l.lift = b.lift
    join athletes a on a.athlete_id = b.athlete_id
  ),
  p4p_ranked as (
    select b.athlete_id, b.lift, b.id,
      (row_number() over (partition by b.lift order by b.ratio desc, l.kg desc, l.meet_date))::int p4p_rank,
      (count(*) over (partition by b.lift))::int p4p_count
    from p4p_best b
    join lifts l on l.id = b.id and l.lift = b.lift
  ),
  picked as (
    select coalesce(ar.athlete_id, pr.athlete_id) athlete_id, coalesce(ar.lift, pr.lift) lift, coalesce(ar.id, pr.id) id,
      ar.abs_rank, pr.p4p_rank, ar.all_rank, ar.abs_count, pr.p4p_count, ar.all_count
    from abs_ranked ar
    full join p4p_ranked pr on pr.athlete_id = ar.athlete_id and pr.lift = ar.lift and pr.id = ar.id
  )
  select a.athlete_id, a.client_id, a.display_name,
    case when lower(regexp_replace(coalesce(l.entered_name, a.athlete_name), '^.*\s', '')) <> lower(regexp_replace(a.display_name, '^.*\s', ''))
      then coalesce(l.entered_name, a.athlete_name) end competed_as,
    a.avatar_url, coalesce(a.user_id = v.uid, false), coalesce(public.community_is_coach(a.user_id), false), a.is_alumni,
    a.sex, p.lift, round(l.kg, 1), l.meet_date, l.meet_name, l.federation, l.weight_class,
    round(l.bw_kg, 1), round(l.kg / l.bw_kg, 2), round(l.gl_points, 2),
    p.abs_rank, p.p4p_rank, p.all_rank,
    max(p.abs_count) over (partition by p.lift, a.sex), max(p.p4p_count) over (partition by p.lift), max(p.all_count) over (partition by p.lift),
    a.athlete_meets, a.first_meet,
    round(r.squat_kg, 1), round(r.bench_kg, 1), round(r.deadlift_kg, 1)
  from picked p
  join lifts l on l.id = p.id and l.lift = p.lift
  join athletes a on a.athlete_id = p.athlete_id
  left join public.athlete_powerlifting_results r on r.id = l.id and p.lift = 'total'
  cross join viewer v
  where v.uid is not null
  order by p.lift, p.all_rank nulls last, p.p4p_rank
$function$;

revoke all on function public.get_strength_board_meets(uuid, text) from public, anon;
grant execute on function public.get_strength_board_meets(uuid, text) to authenticated, service_role;


-- ── Hall of Strength: the roster (Not ranked yet) ──
DROP FUNCTION IF EXISTS public.get_strength_board_roster(uuid);
CREATE OR REPLACE FUNCTION public.get_strength_board_roster(_as_user uuid DEFAULT NULL::uuid, _audience text DEFAULT 'community')
RETURNS TABLE(person text, client_id uuid, display_name text, avatar_url text, is_me boolean, is_coach boolean, is_alumni boolean, sex text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with viewer as (select public.portal_viewer_uid(_as_user) uid),
  people as (
    select 'c:' || c.id person, c.id client_id, c.user_id,
      coalesce(nullif(trim(trim(coalesce(c.first_name, '')) || ' ' || left(trim(coalesce(c.last_name, '')), 1)), ''),
        split_part(coalesce(c.full_name, 'Athlete'), ' ', 1)) display_name,
      coalesce(c.archived, false) or c.archived_at is not null or coalesce(c.status, '') in ('Archived', 'Deactivated') is_alumni,
      coalesce(c.sex, (select a.sex from public.powerlifting_athletes a where a.client_id = c.id order by a.created_at limit 1), '') sx
    from public.clients c
    -- JF Effect Athletes: only active coaching clients, nobody else is "not ranked yet" there
    where public.league_audience_is_all(_audience) or public.league_in_audience(c.id, _audience)
    union all
    select 'a:' || a.id, null, null,
      trim(split_part(trim(a.athlete_name), ' ', 1) || ' ' || left(regexp_replace(trim(a.athlete_name), '^.*\s', ''), 1)),
      lower(coalesce(a.status, 'active')) = 'retired',
      coalesce(a.sex, '')
    from public.powerlifting_athletes a
    where a.client_id is null and public.league_audience_is_all(_audience)
  )
  select p.person, p.client_id, p.display_name, pr.avatar_url,
    coalesce(p.user_id = v.uid, false), coalesce(public.community_is_coach(p.user_id), false), p.is_alumni,
    case when lower(p.sx) like 'f%' then 'female' when lower(p.sx) like 'm%' then 'male' end
  from people p
  left join public.profiles pr on pr.id = p.user_id
  cross join viewer v
  where v.uid is not null
  order by p.display_name
$function$;

REVOKE ALL ON FUNCTION public.get_strength_board_roster(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_strength_board_roster(uuid, text) TO authenticated;


-- ── Monthly League ──
drop function if exists public.get_performance_league(date, uuid);
drop function if exists public.get_performance_league(date, uuid, text);
create or replace function public.get_performance_league(_month date default null, _as_user uuid default null, _audience text default 'community')
returns table(client_id uuid, display_name text, avatar_url text, rank integer, is_me boolean, qualified boolean, bodyweight_value numeric, bodyweight_unit text, total_points integer, workout_points integer, logging_points integer, bodyweight_points integer, improvement_points integer, match_points integer, workouts_completed integer, fully_logged integer, boost_status text, needed_workouts integer, projected_total integer, eligible_workouts integer, completed_eligible integer, adherence_pct numeric, open_workouts integer, match_target integer, projected_match integer, month_start date, final_week_start date, is_final_week boolean, month_closed boolean, finalized boolean, atpr_lifts integer, program_pr_lifts integer, block_pr_lifts integer, last_record_at timestamp with time zone, is_coach boolean, community_posts integer, community_points integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with viewer as (select public.portal_viewer_uid(_as_user) uid),
  -- the board's people: everyone (Community), or only active coaching clients (JF Effect Athletes), re-ranked among themselves in the same order
  scored as (
    select x.*,
      (case when public.league_audience_is_all(_audience) then x.rank
            when x.qualified and x.rank is not null then row_number() over (partition by (x.qualified and x.rank is not null) order by x.rank) end)::int arank
    from public.league_month_scores(_month, now()) x
    where public.league_audience_is_all(_audience) or public.league_in_audience(x.client_id, _audience)
  )
  select s.client_id, s.display_name, s.avatar_url, s.arank, (s.user_id = v.uid), s.qualified,
    s.bodyweight_value, s.bodyweight_unit,
    s.total_points, s.workout_points, s.logging_points, s.bodyweight_points, s.improvement_points, s.match_points,
    s.workouts_completed, s.fully_logged,
    s.boost_status, s.needed_workouts, s.projected_total,
    case when s.user_id = v.uid then s.eligible_workouts end,
    case when s.user_id = v.uid then s.completed_eligible end,
    case when s.user_id = v.uid then s.adherence_pct end,
    case when s.user_id = v.uid then s.open_workouts end,
    case when s.user_id = v.uid then s.match_target end,
    case when s.user_id = v.uid then s.projected_match end,
    s.month_start, s.final_week_start, s.is_final_week, s.month_closed, s.finalized,
    s.atpr_lifts, s.program_pr_lifts, s.block_pr_lifts, s.last_record_at,
    public.community_is_coach(s.user_id),
    s.community_posts, s.community_points
  from scored s, viewer v
  where v.uid is not null
    and ((s.qualified and s.arank <= 50) or s.user_id = v.uid)
  order by s.qualified desc, s.arank nulls last, s.display_name
$function$;

revoke all on function public.get_performance_league(date, uuid, text) from public, anon;
grant execute on function public.get_performance_league(date, uuid, text) to authenticated, service_role;


-- ── Weekly movement and the Monday card ──
DROP FUNCTION IF EXISTS public.get_league_week_movement(uuid);
DROP FUNCTION IF EXISTS public.get_league_week_movement(uuid, text);
CREATE OR REPLACE FUNCTION public.get_league_week_movement(_as_user uuid DEFAULT NULL, _audience text DEFAULT 'community')
RETURNS TABLE (client_id uuid, week_start date, month_start date, rank integer, total_points integer, qualified boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v uuid := public.portal_viewer_uid(_as_user);
  w date := public.league_week_of(now());
  m date := date_trunc('month', public.instant_to_local(now(), public.league_tz()))::date;
BEGIN
  IF v IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT s.client_id, s.week_start, s.month_start, s.rank, s.total_points, s.qualified
      FROM public.league_week_audience_rows(w, _audience) s
     WHERE s.week_start = w
       AND s.month_start = m
       AND w > m;  -- the Monday a month starts on has nothing to compare with yet
END;
$$;
REVOKE ALL ON FUNCTION public.get_league_week_movement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_league_week_movement(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.get_league_week_spotlight(uuid);
DROP FUNCTION IF EXISTS public.get_league_week_spotlight(uuid, text);
CREATE OR REPLACE FUNCTION public.get_league_week_spotlight(_as_user uuid DEFAULT NULL, _audience text DEFAULT 'community')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v uuid := public.portal_viewer_uid(_as_user);
  w date;            -- this week's Monday: last week's standings as it began
  prev date;         -- last week's Monday
  m date;
  me public.league_week_snapshots;
  me_prev public.league_week_snapshots;
  w_at timestamptz;
  prev_at timestamptz;
  prs jsonb;
  result jsonb;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  w := public.league_week_of(now());
  prev := w - 7;
  -- the first week of a month: the monthly recap says it (and last week was mostly last month)
  IF extract(day FROM w) <= 7 THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_week_snapshots s WHERE s.week_start = w) THEN
    PERFORM public.league_week_snapshots_ensure();
  END IF;
  SELECT * INTO me FROM public.league_week_audience_rows(w, _audience) s WHERE s.week_start = w AND s.user_id = v LIMIT 1;
  IF me.client_id IS NULL THEN RETURN NULL; END IF;
  m := me.month_start;
  SELECT * INTO me_prev FROM public.league_week_audience_rows(prev, _audience) s
   WHERE s.week_start = prev AND s.client_id = me.client_id AND s.month_start = m;

  w_at := public.local_to_instant(w::timestamp, public.league_tz());
  prev_at := public.local_to_instant(prev::timestamp, public.league_tz());

  -- your all-time PRs last week (finished workouts, 10 reps or fewer), heaviest first
  SELECT coalesce(jsonb_agg(jsonb_build_object('exercise', r.exercise_name, 'reps', r.reps, 'load_kg', r.load_kg)
                            ORDER BY r.load_kg DESC NULLS LAST), '[]'::jsonb)
    INTO prs
    FROM (
      SELECT DISTINCT ON (x.exercise_key) x.exercise_key, x.exercise_name, x.reps, x.load_kg
        FROM (SELECT * FROM public.client_rep_records(me.client_id)
              UNION ALL
              SELECT * FROM public.client_load_records(me.client_id)) x
       WHERE x.completed AND x.is_atpr AND x.reps BETWEEN 1 AND 10
         AND x.workout_at >= prev_at AND x.workout_at < w_at
       ORDER BY x.exercise_key, x.load_kg DESC NULLS LAST
    ) r;

  WITH now_s AS (
    SELECT s.* FROM public.league_week_audience_rows(w, _audience) s WHERE s.week_start = w AND s.month_start = m
  ), was AS (
    SELECT s.* FROM public.league_week_audience_rows(prev, _audience) s WHERE s.week_start = prev AND s.month_start = m
  ), wk AS (
    SELECT n.client_id, n.user_id = v AS is_me, n.display_name, n.avatar_url, n.rank, n.qualified,
           o.rank AS prev_rank,
           n.total_points,
           n.total_points - coalesce(o.total_points, 0) AS week_points
      FROM now_s n LEFT JOIN was o ON o.client_id = n.client_id
     WHERE n.qualified AND n.rank <= 50
  )
  SELECT jsonb_build_object(
    'week_start', prev,
    'week_end', w - 1,
    'month_start', m,
    -- the week of the League month it was (1, 2, 3…)
    'week_of_month', ((extract(day FROM prev)::int - 1) / 7) + 1,
    'athletes', (SELECT count(*) FROM wk),
    'me', jsonb_build_object(
      'client_id', me.client_id,
      'qualified', me.qualified,
      'rank', me.rank,
      'prev_rank', CASE WHEN me_prev.qualified THEN me_prev.rank END,
      'total_points', me.total_points,
      'week_points', me.total_points - coalesce(me_prev.total_points, 0),
      'workouts', me.workouts_completed - coalesce(me_prev.workouts_completed, 0),
      'fully_logged', me.fully_logged - coalesce(me_prev.fully_logged, 0),
      'bodyweight_logs', me.bodyweight_logs - coalesce(me_prev.bodyweight_logs, 0),
      'posts', me.community_posts - coalesce(me_prev.community_posts, 0),
      'prs', prs),
    -- who moved up the most spots (both weeks ranked)
    'climbers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('client_id', c.client_id, 'name', c.display_name, 'avatar_url', c.avatar_url,
                                          'rank', c.rank, 'prev_rank', c.prev_rank, 'is_me', c.is_me)
                       ORDER BY c.prev_rank - c.rank DESC, c.rank)
        FROM (SELECT * FROM wk WHERE prev_rank IS NOT NULL AND prev_rank > rank
               ORDER BY prev_rank - rank DESC, rank LIMIT 3) c), '[]'::jsonb),
    -- who earned the most points last week
    'top_week', coalesce((
      SELECT jsonb_agg(jsonb_build_object('client_id', t.client_id, 'name', t.display_name, 'avatar_url', t.avatar_url,
                                          'rank', t.rank, 'week_points', t.week_points, 'is_me', t.is_me)
                       ORDER BY t.week_points DESC, t.rank)
        FROM (SELECT * FROM wk WHERE week_points > 0 ORDER BY week_points DESC, rank LIMIT 3) t), '[]'::jsonb),
    -- the crew's week, in two numbers
    'crew', (SELECT jsonb_build_object(
               'workouts', coalesce(sum(n.workouts_completed - coalesce(o.workouts_completed, 0)), 0),
               'records', coalesce(sum(greatest(0, n.record_lifts - coalesce(o.record_lifts, 0))), 0))
               FROM now_s n LEFT JOIN was o ON o.client_id = n.client_id)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_league_week_spotlight(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_league_week_spotlight(uuid, text) TO authenticated;


commit;
