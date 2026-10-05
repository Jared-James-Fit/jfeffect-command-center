-- Monthly Recap: the viewer's training numbers for a league month — total
-- weight lifted (vs the month before), sets, reps, time trained, heaviest set
-- and the lifts whose estimated max went up the most.
--
-- Built on client_qualifying_sets (the same completed, loaded working sets
-- that training records use) and league_month_bounds (same month edges as
-- the league), so the recap never disagrees with records or the leaderboard.
-- _as_user follows portal_viewer_uid: only admins and the client's coach can
-- read another client's numbers.

create or replace function public.get_month_training_stats(_month date default null, _as_user uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with viewer as (select public.portal_viewer_uid(_as_user) uid),
me as (
  select c.id client_id, coalesce(c.preferred_weight_unit, 'lb') unit
    from public.clients c, viewer v
   where v.uid is not null and c.user_id = v.uid
   order by (c.archived_at is null) desc, c.created_at desc
   limit 1
),
target as (
  select coalesce(_month,
    (date_trunc('month', (now() at time zone public.league_tz())::date) - interval '1 month')::date) m
),
b as (select x.* from target t cross join lateral public.league_month_bounds(t.m, now()) x),
pb as (select x.* from target t cross join lateral public.league_month_bounds((t.m - interval '1 month')::date, now()) x),
sets as (
  select q.* from me cross join lateral public.client_qualifying_sets(me.client_id) q
   where q.completed
),
cur as (select s.* from sets s, b where s.workout_at >= b.start_at and s.workout_at < b.end_at),
totals as (
  select coalesce(round(sum(cur.load_kg * cur.reps), 1), 0) tonnage_kg,
         count(*)::int sets,
         coalesce(sum(cur.reps), 0)::int reps
    from cur
),
prev_total as (
  select coalesce(round(sum(s.load_kg * s.reps), 1), 0) tonnage_kg
    from sets s, pb where s.workout_at >= pb.start_at and s.workout_at < pb.end_at
),
-- One duration per session (legacy duplicate completions), capped so a
-- workout left open overnight can't claim 9 hours.
sessions as (
  select distinct on (coalesce('sw:' || dc.scheduled_workout_id, 'day:' || dc.day_id))
         least(dc.actual_duration_min, 180) minutes
    from public.pl_day_completions dc, me, b
   where dc.client_id = me.client_id
     and dc.completed_at >= b.start_at and dc.completed_at < b.end_at
     and dc.actual_duration_min > 0
   order by coalesce('sw:' || dc.scheduled_workout_id, 'day:' || dc.day_id), dc.completed_at
),
heaviest as (
  select cur.exercise_name, cur.load_kg, cur.reps
    from cur order by cur.load_kg desc, cur.reps desc, cur.set_completed_at limit 1
),
-- Estimated 1-rep max (Brzycki, sets of 1–10 reps) — best this month vs best
-- before it. Lifts with no earlier history can't show a gain.
e1rm as (
  select s.exercise_key, s.exercise_name, s.workout_at,
         s.load_kg * 36.0 / (37.0 - s.reps) e1rm_kg
    from sets s where s.reps between 1 and 10
),
gains as (
  select c.exercise_name, round(p.best, 1) prev_e1rm_kg, round(c.best, 1) e1rm_kg,
         (c.best / p.best - 1) pct
    from (select distinct on (e.exercise_key) e.exercise_key, e.exercise_name, e.e1rm_kg best
            from e1rm e, b where e.workout_at >= b.start_at and e.workout_at < b.end_at
           order by e.exercise_key, e.e1rm_kg desc) c
    join (select e.exercise_key, max(e.e1rm_kg) best
            from e1rm e, b where e.workout_at < b.start_at group by e.exercise_key) p using (exercise_key)
   where p.best > 0 and c.best > p.best * 1.005
)
select case when not exists (select 1 from me) then null else jsonb_build_object(
  'unit', (select unit from me),
  'tonnage_kg', (select tonnage_kg from totals),
  'prev_tonnage_kg', (select tonnage_kg from prev_total),
  'sets', (select sets from totals),
  'reps', (select reps from totals),
  'sessions_timed', (select count(*)::int from sessions),
  'minutes', (select coalesce(sum(minutes), 0)::int from sessions),
  'heaviest', (select jsonb_build_object('exercise_name', h.exercise_name, 'load_kg', h.load_kg, 'reps', h.reps) from heaviest h),
  'gains', coalesce((select jsonb_agg(jsonb_build_object(
      'exercise_name', g.exercise_name, 'prev_e1rm_kg', g.prev_e1rm_kg, 'e1rm_kg', g.e1rm_kg) order by g.pct desc)
    from (select * from gains order by pct desc limit 3) g), '[]'::jsonb)
) end
$function$;

revoke all on function public.get_month_training_stats(date, uuid) from public, anon;
grant execute on function public.get_month_training_stats(date, uuid) to authenticated, service_role;
