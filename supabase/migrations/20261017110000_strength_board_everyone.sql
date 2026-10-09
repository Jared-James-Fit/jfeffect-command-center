-- Hall of Strength: get everyone who squats, benches and deadlifts on the board.
--
-- What changes
--   * Lifts: full-range barbell squat / bench / deadlift variations count, not
--     only the three "Competition" exercises: high/low bar, paused, tempo,
--     touch-and-go, close-grip, sumo/conventional, deficit. Partial-range,
--     machine, dumbbell, specialty-bar and RDL-type movements don't
--     (strength_board_lift()). Paused/tempo/deficit work is harder, so counting
--     it can only understate a max, never inflate it. An exercise tagged with a
--     competition_lift_type always counts as that lift.
--   * The number is still the heaviest weight actually lifted (any reps, no
--     estimates); the reps are returned with it.
--   * Bodyweight for pound for pound: the log closest to the lift, whenever it
--     was (was: within 30 days). The typo check still only trusts a bodyweight
--     within 30 days, so an old weigh-in can't wrongly flag a lift.
--   * Pound for pound ranks by x bodyweight (relative strength), was DOTS. One
--     board for everyone; sex isn't needed.
--   * Absolute gets an "All" ranking (all_rank / all_count, trailing columns);
--     Men / Women still use abs_rank for athletes whose sex is known.

-- ── Which lift an exercise counts as (null = doesn't count) ───────────────
create or replace function public.strength_board_lift(_name text, _competition_type text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when _competition_type in ('squat', 'bench', 'deadlift') then _competition_type
    when _name is null then null
    when _name ~* '(dumbbell|\mdb\M|kettlebell|goblet|split|bulgarian|lunge|step ?up|hack|belt squat|pendulum|leg press|smith|machine|\mpin\M|\mbox\M|board|block|rack|partial|front|zercher|safety|\mssb\M|cambered|trap|\mhex\M|romanian|\mrdl\M|stiff|sldl|single|one[- ]arm|incline|decline|floor|spoto|larsen|attachment|landmine|band|chain|curl|extension|\mdip|sit ?up|\mfly\M|bodyweight|assist|cable|jump|overhead)'
      then null
    when _name ~* 'squat' then 'squat'
    when _name ~* 'bench' and _name ~* 'press' then 'bench'
    when _name ~* 'dead ?lift' then 'deadlift'
  end
$$;
revoke all on function public.strength_board_lift(text, text) from public, anon, authenticated;

-- ── Every squat / bench / deadlift set, with bodyweight and the typo check ─
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
  with board_exercises as materialized (
    select e.id, public.strength_board_lift(e.name, e.competition_lift_type) lift
    from public.exercises e
    where public.strength_board_lift(e.name, e.competition_lift_type) is not null
  ),
  sets as materialized (
    select r.id result_id, r.client_id, c.user_id, bx.lift,
      coalesce(r.normalized_kg, r.actual_load_kg,
        case when lower(coalesce(r.actual_load_unit, r.entered_unit)) = 'lb'
          then coalesce(r.actual_load, r.entered_value) * 0.45359237
          else coalesce(r.actual_load, r.entered_value) end) load_kg,
      r.actual_reps::int reps,
      r.completed_at lifted_at,
      (r.completed_at at time zone public.league_tz())::date lift_day
    from public.pl_row_results r
    join public.pl_exercise_rows er on er.id = r.row_id
    join board_exercises bx on bx.id = er.exercise_id
    join public.clients c on c.id = r.client_id
    where r.completed_at is not null
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
    -- Both bodyweight sources, in kg, for athletes with lifts only.
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
    -- The bodyweight log closest to the lift day, whenever it was (earlier wins
    -- a tie; two logs on one day: the newest entry). near = within 30 days.
    select z.client_id, z.lift_day, z.kg bw_kg, z.gap <= 30 near
    from (
      select d.client_id, d.lift_day, b.kg, abs(b.d - d.lift_day) gap,
        row_number() over (partition by d.client_id, d.lift_day
          order by abs(b.d - d.lift_day), b.d <= d.lift_day desc, b.entered_at desc, b.kg desc) rn
      from lift_days d
      join bodyweights b on b.client_id = d.client_id
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
        when b.near
          and s.load_kg * 36.0 / (37 - least(s.reps, 12)) / b.bw_kg > case s.lift when 'squat' then 4.0 when 'bench' then 3.0 else 4.5 end
          then 'Too many times bodyweight to be real'
      end hard_flag
    from sets s
    left join day_bw b on b.client_id = s.client_id and b.lift_day = s.lift_day
    left join public.strength_board_reviews rv on rv.result_id = s.result_id
    where s.load_kg > 0
  ),
  day_best as materialized (
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

-- ── The board ─────────────────────────────────────────────────────────────
-- Return type gains all_rank / all_count (trailing), so drop and recreate.
drop function if exists public.get_strength_board(uuid);
create function public.get_strength_board(_as_user uuid default null)
returns table(
  client_id uuid,
  display_name text,
  avatar_url text,
  is_me boolean,
  is_coach boolean,
  sex text,
  lift text,
  kg numeric,
  reps integer,
  lifted_at timestamptz,
  bw_kg numeric,
  bw_multiple numeric,
  dots numeric,
  abs_rank integer,
  p4p_rank integer,
  abs_count integer,
  p4p_count integer,
  all_rank integer,
  all_count integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with viewer as (select public.portal_viewer_uid(_as_user) uid),
  valid as (
    select s.* from public.strength_board_sets() s
    where coalesce(s.review, '') <> 'excluded' and (s.flag is null or s.review = 'approved')
  ),
  best as (
    -- Heaviest weight per athlete per lift; more reps, then the earlier date, break ties.
    select distinct on (v.client_id, v.lift) v.client_id, v.lift, v.load_kg kg, v.reps, v.lifted_at, v.bw_kg
    from valid v
    order by v.client_id, v.lift, v.load_kg desc, v.reps desc, v.lifted_at
  ),
  totals as (
    select b.client_id, 'total'::text lift, sum(b.kg) kg, null::integer reps, max(b.lifted_at) lifted_at,
      case when count(b.bw_kg) = 3 then max(b.bw_kg) end bw_kg
    from best b
    group by b.client_id
    having count(*) = 3
  ),
  entries as (
    select * from best
    union all
    select * from totals
  ),
  athletes as (
    select c.id client_id, c.user_id,
      coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || left(coalesce(c.last_name, ''), 1)), ''),
        split_part(coalesce(c.full_name, 'Athlete'), ' ', 1)) display_name,
      p.avatar_url,
      case
        when lower(coalesce(c.sex, pa.sex, '')) like 'f%' then 'female'
        when lower(coalesce(c.sex, pa.sex, '')) like 'm%' then 'male'
      end sex
    from public.clients c
    left join public.profiles p on p.id = c.user_id
    left join lateral (
      select a.sex from public.powerlifting_athletes a where a.client_id = c.id order by a.created_at limit 1
    ) pa on true
  ),
  scored as (
    select e.*, a.user_id, a.display_name, a.avatar_url, a.sex,
      round(e.kg / nullif(e.bw_kg, 0), 2) bw_multiple,
      e.kg / nullif(e.bw_kg, 0) bw_ratio,
      case when a.sex is not null then public.dots_points(a.sex, e.bw_kg, e.kg) end dots
    from entries e
    join athletes a on a.client_id = e.client_id
  ),
  ranked as (
    select s.*,
      case when s.sex is not null then (row_number() over (
        partition by s.lift, s.sex is not null, s.sex
        order by s.kg desc, s.reps desc nulls last, s.lifted_at))::integer end abs_rank,
      case when s.bw_ratio is not null then (row_number() over (
        partition by s.lift, s.bw_ratio is not null
        order by s.bw_ratio desc, s.kg desc, s.lifted_at))::integer end p4p_rank,
      case when s.sex is not null then (count(*) over (partition by s.lift, s.sex is not null, s.sex))::integer end abs_count,
      case when s.bw_ratio is not null then (count(*) over (partition by s.lift, s.bw_ratio is not null))::integer end p4p_count,
      (row_number() over (partition by s.lift order by s.kg desc, s.reps desc nulls last, s.lifted_at))::integer all_rank,
      (count(*) over (partition by s.lift))::integer all_count
    from scored s
  )
  select r.client_id, r.display_name, r.avatar_url, (r.user_id = v.uid), public.community_is_coach(r.user_id),
    r.sex, r.lift, round(r.kg, 1), r.reps, r.lifted_at, r.bw_kg, r.bw_multiple, r.dots,
    r.abs_rank, r.p4p_rank, r.abs_count, r.p4p_count, r.all_rank, r.all_count
  from ranked r, viewer v
  where v.uid is not null
    and (r.all_rank <= 10 or r.abs_rank <= 10 or r.p4p_rank <= 10 or r.user_id = v.uid)
  order by r.lift, r.all_rank
$$;
revoke all on function public.get_strength_board(uuid) from public, anon;
grant execute on function public.get_strength_board(uuid) to authenticated, service_role;

-- Coach list: who has lifts but can't show everywhere yet.
-- 'bodyweight' = never logged one (no pound for pound);
-- 'division' = sex not set (shows on All, not on Men / Women).
create or replace function public.get_strength_board_unranked()
returns table(client_id uuid, display_name text, missing text, lifts integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.league_is_staff() then raise exception 'Staff access required' using errcode = '42501'; end if;
  return query
  with valid as (
    select s.client_id, s.lift, s.bw_kg from public.strength_board_sets() s
    where coalesce(s.review, '') <> 'excluded' and (s.flag is null or s.review = 'approved')
  ),
  per as (
    select v.client_id, count(distinct v.lift)::int lifts, bool_or(v.bw_kg is not null) any_bw
    from valid v group by v.client_id
  )
  select c.id,
    coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || left(coalesce(c.last_name, ''), 1)), ''),
      split_part(coalesce(c.full_name, 'Athlete'), ' ', 1)),
    m.missing,
    p.lifts
  from per p
  join public.clients c on c.id = p.client_id
  left join lateral (
    select a.sex from public.powerlifting_athletes a where a.client_id = c.id order by a.created_at limit 1
  ) pa on true
  cross join lateral (
    select 'bodyweight'::text missing where not p.any_bw
    union all
    select 'division' where coalesce(c.sex, pa.sex, '') !~* '^(m|f)'
  ) m
  order by 3, 2;
end;
$$;
revoke all on function public.get_strength_board_unranked() from public, anon;
grant execute on function public.get_strength_board_unranked() to authenticated, service_role;
