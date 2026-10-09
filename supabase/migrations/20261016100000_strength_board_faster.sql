-- Hall of Strength: same results, much less work.
--
-- strength_board_sets() looked up the bodyweight once per set (each lookup
-- scanning every bodyweight log) and checked "big jump over every other
-- session" by rescanning all of that athlete's sets for every set. Both grow
-- quadratically with history. Now:
--   * bodyweight is resolved once per athlete per lift day with one join
--     (athletes with competition lifts only) instead of once per set;
--   * each athlete/lift's two best training days (e1RM, typo-free sets) are
--     computed once; "every other session" is the best day, or the second
--     best when this set is on the best day.
-- Every intermediate step is MATERIALIZED: the planner estimates the
-- competition-set step at ~1 row and would otherwise recompute the bodyweight
-- and best-day lookups once per set.
-- Output columns, rules and thresholds are unchanged.

create or replace function public.strength_board_sets()
returns table(
  result_id uuid,
  client_id uuid,
  lift text,
  load_kg numeric,
  reps integer,
  lifted_at timestamptz,
  lift_day date,
  bw_kg numeric,
  e1rm_kg numeric,
  flag text,
  review text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with sets as (
    select r.id result_id, r.client_id, c.user_id, e.competition_lift_type lift,
      coalesce(r.normalized_kg, r.actual_load_kg,
        case when lower(coalesce(r.actual_load_unit, r.entered_unit)) = 'lb'
          then coalesce(r.actual_load, r.entered_value) * 0.45359237
          else coalesce(r.actual_load, r.entered_value) end) load_kg,
      r.actual_reps::int reps,
      r.completed_at lifted_at,
      (r.completed_at at time zone public.league_tz())::date lift_day
    from public.pl_row_results r
    join public.pl_exercise_rows er on er.id = r.row_id
    join public.exercises e on e.id = er.exercise_id
    join public.clients c on c.id = r.client_id
    where e.is_competition_lift
      and e.competition_lift_type in ('squat', 'bench', 'deadlift')
      and r.completed_at is not null
      and r.actual_reps >= 1
      and coalesce(r.load_type, 'external') = 'external'
      and coalesce(r.is_bodyweight, false) = false
      and coalesce(r.is_working_set, true)
      and coalesce(c.archived, false) = false and c.archived_at is null and coalesce(c.status, '') <> 'Archived'
  ),
  lift_days as materialized (
    select distinct s.client_id, s.user_id, s.lift_day from sets s
  ),
  bodyweights as materialized (
    -- Both bodyweight sources, in kg, for athletes with competition lifts only.
    select a.client_id, x.d, x.kg, x.entered_at
    from (select distinct l.client_id, l.user_id from lift_days l) a
    cross join lateral (
      select pb.logged_date d,
        pb.weight_value * case when lower(coalesce(pb.weight_unit, 'lb')) = 'kg' then 1 else 0.45359237 end kg,
        pb.created_at entered_at
      from public.progress_bodyweight pb
      where pb.user_id = a.user_id and pb.weight_value > 0
      union all
      select pm.entry_date,
        pm.bodyweight * case when lower(coalesce(pm.bodyweight_unit, 'lb')) = 'kg' then 1 else 0.45359237 end,
        pm.created_at
      from public.progress_metrics pm
      where pm.client_id = a.client_id and pm.bodyweight > 0
    ) x
    where x.kg between 30 and 250
  ),
  day_bw as materialized (
    -- The bodyweight log closest to the lift day (within 30 days, earlier wins a
    -- tie). Two logs on the same day: the most recently entered one, like the
    -- league's current bodyweight (this used to be arbitrary).
    select z.client_id, z.lift_day, z.kg bw_kg
    from (
      select d.client_id, d.lift_day, b.kg,
        row_number() over (partition by d.client_id, d.lift_day
          order by abs(b.d - d.lift_day), b.d <= d.lift_day desc, b.entered_at desc, b.kg desc) rn
      from lift_days d
      join bodyweights b on b.client_id = d.client_id and b.d between d.lift_day - 30 and d.lift_day + 30
    ) z
    where z.rn = 1
  ),
  hard as materialized (
    select s.result_id, s.client_id, s.lift, s.load_kg, s.reps, s.lifted_at, s.lift_day, b.bw_kg,
      s.load_kg * 36.0 / (37 - least(s.reps, 12)) e1rm_kg,
      rv.status review,
      case
        when s.load_kg * 36.0 / (37 - least(s.reps, 12)) > case s.lift when 'squat' then 500 when 'bench' then 360 else 470 end
          then 'Heavier than the world record'
        when b.bw_kg is not null
          and s.load_kg * 36.0 / (37 - least(s.reps, 12)) / b.bw_kg > case s.lift when 'squat' then 4.0 when 'bench' then 3.0 else 4.5 end
          then 'Too many times bodyweight to be real'
      end hard_flag
    from sets s
    left join day_bw b on b.client_id = s.client_id and b.lift_day = s.lift_day
    left join public.strength_board_reviews rv on rv.result_id = s.result_id
    where s.load_kg > 0
  ),
  day_best as materialized (
    -- Best e1RM per training day from sets that passed the hard checks and weren't removed.
    select h.client_id, h.lift, h.lift_day, max(h.e1rm_kg) best
    from hard h
    where h.hard_flag is null and coalesce(h.review, '') <> 'excluded'
    group by 1, 2, 3
  ),
  top_days as materialized (
    select t.client_id, t.lift,
      max(t.best) filter (where t.rn = 1) best1,
      max(t.lift_day) filter (where t.rn = 1) best1_day,
      max(t.best) filter (where t.rn = 2) best2
    from (
      select db.*, row_number() over (partition by db.client_id, db.lift order by db.best desc, db.lift_day) rn
      from day_best db
    ) t
    where t.rn <= 2
    group by 1, 2
  )
  select h.result_id, h.client_id, h.lift, round(h.load_kg, 2), h.reps, h.lifted_at, h.lift_day,
    round(h.bw_kg, 1), round(h.e1rm_kg, 1),
    coalesce(h.hard_flag,
      case when h.e1rm_kg > 1.35 * (case when h.lift_day = td.best1_day then td.best2 else td.best1 end)
        then 'Big jump over every other session' end),
    h.review
  from hard h
  left join top_days td on td.client_id = h.client_id and td.lift = h.lift
$$;
revoke all on function public.strength_board_sets() from public, anon, authenticated;
