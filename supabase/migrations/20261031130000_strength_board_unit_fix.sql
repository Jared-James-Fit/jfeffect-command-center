-- Hall of Strength review: fix a lift typed in lb but saved as kg, in one tap.
--
-- Most "massive numbers" held back for review were lb numbers typed into a
-- card that was in kg (an lb squatter's first Competition Squat opened in kg):
-- 305 lb saved as 305 kg = 672 lb, "too many times bodyweight to be real".
-- "Count it" counted the wrong number and "Remove" threw away a real lift.
--
--   * get_strength_board_review() also returns what was typed (entered_value,
--     entered_unit) and likely_lb: the lift was saved in kg; read as lb it
--     passes the typo checks and fits the athlete's other sessions; and either
--     it's impossible in kg (world record / bodyweight multiple) or the athlete
--     logs this lift in lb on their other days. The last part keeps a real kg
--     lifter's genuine big jump from being offered as an lb typo.
--   * strength_board_fix_unit(result_id) relabels that card's sets that day
--     from kg to lb (the number stays, the unit changes), audited in
--     logged_set_edit_audit, and returns the ids it changed.
--   * strength_board_unfix_unit(ids) undoes exactly those sets.

drop function if exists public.get_strength_board_review();
create function public.get_strength_board_review()
returns table(
  result_id uuid,
  client_id uuid,
  display_name text,
  lift text,
  load_kg numeric,
  reps integer,
  sets integer,
  lift_day date,
  bw_kg numeric,
  flag text,
  review text,
  counted_best_kg numeric,
  entered_value numeric,
  entered_unit text,
  likely_lb boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.league_is_staff() then raise exception 'Staff access required' using errcode = '42501'; end if;
  return query
  with s as (select * from public.strength_board_sets()),
  counted as (
    select x.client_id, x.lift, max(x.load_kg) best
    from s x
    where coalesce(x.review, '') <> 'excluded' and (x.flag is null or x.review = 'approved')
    group by 1, 2
  ),
  clean_days as (
    -- Each athlete/lift's typo-free best e1RM per day: what a flagged lift
    -- read as lb has to fit.
    select x.client_id, x.lift, x.lift_day, max(x.e1rm_kg) best
    from s x
    where x.flag is null and coalesce(x.review, '') <> 'excluded'
    group by 1, 2, 3
  ),
  grouped as (
    select x.client_id, x.lift, x.lift_day, x.load_kg,
      (array_agg(x.result_id order by x.lifted_at))[1] result_id,
      max(x.reps) reps, count(*)::int sets, max(x.bw_kg) bw_kg,
      max(x.flag) flag, max(x.review) review
    from s x
    where x.flag is not null or x.review is not null
    group by 1, 2, 3, 4
  )
  select g.result_id, g.client_id,
    coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || left(coalesce(c.last_name, ''), 1)), ''),
      split_part(coalesce(c.full_name, 'Athlete'), ' ', 1)),
    g.lift, g.load_kg, g.reps, g.sets, g.lift_day, g.bw_kg, g.flag, g.review, ct.best,
    coalesce(r.entered_value, r.actual_load),
    lower(coalesce(r.entered_unit, r.actual_load_unit)),
    coalesce(
      g.flag is not null
      and lower(coalesce(r.entered_unit, r.actual_load_unit)) = 'kg'
      -- read as lb: passes the typo checks ...
      and alt.e1rm <= lim.cap
      and (g.bw_kg is null or alt.e1rm / g.bw_kg <= lim.bw_multiple)
      -- ... and fits their other sessions
      and (ref.best is null or alt.e1rm between 0.5 * ref.best and 1.35 * ref.best)
      -- ... and it's impossible in kg, or they log this lift in lb
      and (alt.e1rm / 0.45359237 > lim.cap
        or (g.bw_kg is not null and alt.e1rm / 0.45359237 / g.bw_kg > lim.bw_multiple)
        or habit.lb > habit.kg),
      false)
  from grouped g
  join public.clients c on c.id = g.client_id
  join public.pl_row_results r on r.id = g.result_id
  left join counted ct on ct.client_id = g.client_id and ct.lift = g.lift
  cross join lateral (select g.load_kg * 0.45359237 * 36.0 / (37 - least(g.reps, 12)) e1rm) alt
  cross join lateral (
    select case g.lift when 'squat' then 500 when 'bench' then 360 else 470 end cap,
      case g.lift when 'squat' then 4.0 when 'bench' then 3.0 else 4.5 end bw_multiple
  ) lim
  left join lateral (
    select max(cd.best) best from clean_days cd
    where cd.client_id = g.client_id and cd.lift = g.lift and cd.lift_day <> g.lift_day
  ) ref on true
  cross join lateral (
    select count(*) filter (where lower(r2.actual_load_unit) = 'lb') lb,
      count(*) filter (where lower(r2.actual_load_unit) = 'kg') kg
    from s x
    join public.pl_row_results r2 on r2.id = x.result_id
    where g.flag is not null and x.client_id = g.client_id and x.lift = g.lift and x.lift_day <> g.lift_day
  ) habit
  where g.review is not null or ct.best is null or g.load_kg > ct.best
  order by (g.review is null) desc, g.load_kg desc;
end;
$$;
revoke all on function public.get_strength_board_review() from public, anon;
grant execute on function public.get_strength_board_review() to authenticated, service_role;

-- Relabel the card's kg sets that day as lb (one card = one unit, so a typo'd
-- card is wrong on every set, not only the heaviest).
create or replace function public.strength_board_fix_unit(_result_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t record;
  ids uuid[];
begin
  if not public.league_is_staff() then raise exception 'Staff access required' using errcode = '42501'; end if;

  select r.client_id, r.row_id, (r.completed_at at time zone public.league_tz())::date d into t
  from public.pl_row_results r
  where r.id = _result_id and r.completed_at is not null;
  if t.client_id is null then raise exception 'Lift not found'; end if;

  with hit as (
    select r.id, r.client_id, er.exercise_id, e.name ex_name, coalesce(r.entered_value, r.actual_load) typed_load
    from public.pl_row_results r
    join public.pl_exercise_rows er on er.id = r.row_id
    left join public.exercises e on e.id = er.exercise_id
    where r.client_id = t.client_id and r.row_id = t.row_id
      and r.completed_at is not null
      and (r.completed_at at time zone public.league_tz())::date = t.d
      and lower(coalesce(r.entered_unit, r.actual_load_unit, '')) = 'kg'
      and lower(coalesce(r.actual_load_unit, 'kg')) = 'kg'
      and (r.entered_value is null or r.actual_load is null or r.entered_value = r.actual_load)
  ),
  upd as (
    update public.pl_row_results r set actual_load_unit = 'lb', entered_unit = 'lb'
    from hit h where r.id = h.id
    returning r.id
  ),
  aud as (
    insert into public.logged_set_edit_audit (set_log_id, client_id, exercise_id, exercise_name, field_changed,
      previous_value, new_value, edited_by_user_id, edited_by_role, edit_source, reason, details)
    select h.id, h.client_id, h.exercise_id, h.ex_name, 'unit', 'kg', 'lb', auth.uid(), 'coach',
      'strength_board_unit_fix', 'Typed in lb, saved as kg', jsonb_build_object('load', h.typed_load)
    from hit h
    returning 1
  )
  select array_agg(u.id) into ids from upd u;

  -- Corrected sets go back to the automatic typo check.
  delete from public.strength_board_reviews rv where rv.result_id = any(coalesce(ids, '{}'::uuid[]));
  return coalesce(ids, '{}'::uuid[]);
end;
$$;
revoke all on function public.strength_board_fix_unit(uuid) from public, anon;
grant execute on function public.strength_board_fix_unit(uuid) to authenticated, service_role;

-- Undo: only sets this fix changed and that are still in lb.
create or replace function public.strength_board_unfix_unit(_result_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  if not public.league_is_staff() then raise exception 'Staff access required' using errcode = '42501'; end if;

  with hit as (
    select r.id, r.client_id, er.exercise_id, e.name ex_name, coalesce(r.entered_value, r.actual_load) typed_load
    from public.pl_row_results r
    join public.pl_exercise_rows er on er.id = r.row_id
    left join public.exercises e on e.id = er.exercise_id
    where r.id = any(coalesce(_result_ids, '{}'::uuid[]))
      and lower(coalesce(r.entered_unit, r.actual_load_unit, '')) = 'lb'
      and exists (
        select 1 from public.logged_set_edit_audit a
        where a.set_log_id = r.id and a.edit_source = 'strength_board_unit_fix'
      )
  ),
  upd as (
    update public.pl_row_results r set actual_load_unit = 'kg', entered_unit = 'kg'
    from hit h where r.id = h.id
    returning r.id
  ),
  aud as (
    insert into public.logged_set_edit_audit (set_log_id, client_id, exercise_id, exercise_name, field_changed,
      previous_value, new_value, edited_by_user_id, edited_by_role, edit_source, reason, details)
    select h.id, h.client_id, h.exercise_id, h.ex_name, 'unit', 'lb', 'kg', auth.uid(), 'coach',
      'strength_board_unit_fix_undo', 'Undo: back to kg', jsonb_build_object('load', h.typed_load)
    from hit h
    returning 1
  )
  select count(*)::int into n from upd;
  return n;
end;
$$;
revoke all on function public.strength_board_unfix_unit(uuid[]) from public, anon;
grant execute on function public.strength_board_unfix_unit(uuid[]) to authenticated, service_role;
