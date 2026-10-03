\set ON_ERROR_STOP 1
set client_min_messages = notice;
do $$
declare
  five uuid; three uuid; gamer uuid; injured uuid; laterem uuid; joiner uuid; mover uuid; dupe uuid; edge uuid; tie1 uuid; tie2 uuid; nobw uuid; zero uuid;
  d uuid; i int; dt date; ids uuid[];
  r record; n int;
  dates12 date[] := array['2026-10-02','2026-10-05','2026-10-07','2026-10-09','2026-10-12','2026-10-14','2026-10-16','2026-10-19','2026-10-21','2026-10-23','2026-10-26','2026-10-28']::date[];
begin
  five := t_client('Five'); three := t_client('Three'); gamer := t_client('Gamer'); injured := t_client('Injured');
  laterem := t_client('Laterem'); mover := t_client('Mover'); dupe := t_client('Dupe'); edge := t_client('Edge');
  tie1 := t_client('Tiea'); tie2 := t_client('Tieb'); nobw := t_client('Nobw', '2026-06-01', false); zero := t_client('Zero');

  -- FIVE: 20 prescribed (Oct 1-20) all done + 3 custom extras done -> legit 200, points 230
  for i in 1..20 loop d := t_session(five, ('2026-10-01'::date + i - 1)); perform t_complete(five, d, wpg(('2026-10-01'::date + i - 1)::text || ' 18:00')); end loop;
  for i in 1..3 loop d := t_session(five, ('2026-10-0'||i)::date, true); perform t_complete(five, d, wpg('2026-10-0'||i||' 19:00')); end loop;

  -- THREE: 12, misses Oct 5
  foreach dt in array dates12 loop d := t_session(three, dt); if dt <> '2026-10-05' then perform t_complete(three, d, wpg(dt::text||' 18:00'), true); end if; end loop;
  -- GAMER: 12, misses 9 & 12 (will delete them later), completes the rest
  foreach dt in array dates12 loop d := t_session(gamer, dt); if dt not in ('2026-10-09','2026-10-12') then perform t_complete(gamer, d, wpg(dt::text||' 18:00')); end if; end loop;
  -- INJURED: 12, coach removes 4 future sessions on Oct 10; completes the 8 that remain
  foreach dt in array dates12 loop d := t_session(injured, dt); if dt not in ('2026-10-19','2026-10-21','2026-10-23','2026-10-26') then perform t_complete(injured, d, wpg(dt::text||' 18:00')); end if; end loop;
  -- LATEREM: 12, completes first 9; removes 23/26/28 after the freeze
  foreach dt in array dates12 loop d := t_session(laterem, dt); if dt < '2026-10-23' then perform t_complete(laterem, d, wpg(dt::text||' 18:00')); end if; end loop;
  -- MOVER: Oct 2, 9, 16 (moved to 17), 23 (moved to Nov 2 before it was due)
  foreach dt in array array['2026-10-02','2026-10-09','2026-10-16','2026-10-23']::date[] loop d := t_session(mover, dt); end loop;
  -- DUPE: 4 sessions, Oct 2 completed twice (legacy duplicate rows)
  foreach dt in array array['2026-10-02','2026-10-09','2026-10-16','2026-10-23']::date[] loop d := t_session(dupe, dt); perform t_complete(dupe, d, wpg(dt::text||' 18:00')); end loop;
  perform t_complete(dupe, (select pd.id from pl_days pd join pl_weeks w on w.id=pd.week_id join pl_blocks b on b.id=w.block_id where b.client_id=dupe and pd.scheduled_date='2026-10-02'), wpg('2026-10-02 18:30'));
  -- EDGE: Oct 31 session completed 23:30 local (04:30 UTC Nov 1); a Nov 1 00:10 local completion must not count
  d := t_session(edge, '2026-10-31'); perform t_complete(edge, d, wpg('2026-10-31 23:30'));
  d := t_session(edge, '2026-10-30'); perform t_complete(edge, d, wpg('2026-11-01 00:10'));
  -- TIES: identical activity
  d := t_session(tie1, '2026-10-02'); perform t_complete(tie1, d, wpg('2026-10-02 18:00'));
  d := t_session(tie2, '2026-10-02'); perform t_complete(tie2, d, wpg('2026-10-02 18:00'));
  -- NOBW: 25 legit completions but no bodyweight -> not on the board, must not set the ceiling
  for i in 1..25 loop d := t_session(nobw, ('2026-10-01'::date + i - 1)); perform t_complete(nobw, d, wpg(('2026-10-01'::date + i - 1)::text || ' 18:00')); end loop;

  -- ===== Timeline =====
  perform capture_league_prescriptions(wpg('2026-10-03 12:00'));
  -- Oct 10: coach removes Injured's 4 future sessions (genuine programming change)
  update pl_days set deleted_at = now() where id in (select pd.id from pl_days pd join pl_weeks w on w.id=pd.week_id join pl_blocks b on b.id=w.block_id where b.client_id=injured and pd.scheduled_date in ('2026-10-19','2026-10-21','2026-10-23','2026-10-26'));
  perform capture_league_prescriptions(wpg('2026-10-10 12:00'));
  -- Oct 12: Mover reschedules Oct 23 -> Nov 2 (before it was due)
  insert into pl_scheduled_workouts(source_day_id, scheduled_date) select pd.id, '2026-11-02' from pl_days pd join pl_weeks w on w.id=pd.week_id join pl_blocks b on b.id=w.block_id where b.client_id=mover and pd.scheduled_date='2026-10-23';
  perform capture_league_prescriptions(wpg('2026-10-12 12:00'));
  -- Oct 16: Mover moves Fri Oct 16 -> Sat Oct 17 and completes it Saturday
  insert into pl_scheduled_workouts(source_day_id, scheduled_date) select pd.id, '2026-10-17' from pl_days pd join pl_weeks w on w.id=pd.week_id join pl_blocks b on b.id=w.block_id where b.client_id=mover and pd.scheduled_date='2026-10-16';
  perform capture_league_prescriptions(wpg('2026-10-16 08:00'));
  perform t_complete(mover, (select pd.id from pl_days pd join pl_weeks w on w.id=pd.week_id join pl_blocks b on b.id=w.block_id where b.client_id=mover and pd.scheduled_date='2026-10-02'), wpg('2026-10-02 18:00'));
  perform t_complete(mover, (select pd.id from pl_days pd join pl_weeks w on w.id=pd.week_id join pl_blocks b on b.id=w.block_id where b.client_id=mover and pd.scheduled_date='2026-10-09'), wpg('2026-10-09 18:00'));
  perform t_complete(mover, (select pd.id from pl_days pd join pl_weeks w on w.id=pd.week_id join pl_blocks b on b.id=w.block_id where b.client_id=mover and pd.scheduled_date='2026-10-16'), wpg('2026-10-17 10:00'));
  perform capture_league_prescriptions(wpg('2026-10-17 12:00'));
  -- Oct 20: Joiner signs up, gets 4 sessions
  joiner := t_client('Joiner', wpg('2026-10-20 09:00'));
  foreach dt in array array['2026-10-21','2026-10-23','2026-10-26','2026-10-28']::date[] loop d := t_session(joiner, dt); perform t_complete(joiner, d, wpg(dt::text||' 18:00')); end loop;
  perform capture_league_prescriptions(wpg('2026-10-20 12:00'));
  -- Oct 22: Gamer deletes the two missed (already-due) sessions
  update pl_days set deleted_at = now() where id in (select pd.id from pl_days pd join pl_weeks w on w.id=pd.week_id join pl_blocks b on b.id=w.block_id where b.client_id=gamer and pd.scheduled_date in ('2026-10-09','2026-10-12'));
  perform capture_league_prescriptions(wpg('2026-10-22 12:00'));
  perform capture_league_prescriptions(wpg('2026-10-24 23:00'));
  -- Freeze: Oct 25 00:00 local
  perform capture_league_prescriptions(wpg('2026-10-25 00:05'));
  -- Final week: Gamer adds 3 easy sessions and does them; Laterem deletes 3 remaining
  for i in 0..2 loop d := t_session(gamer, ('2026-10-27'::date + i)); perform t_complete(gamer, d, wpg(('2026-10-27'::date + i)::text || ' 07:00')); end loop;
  update pl_days set deleted_at = now() where id in (select pd.id from pl_days pd join pl_weeks w on w.id=pd.week_id join pl_blocks b on b.id=w.block_id where b.client_id=laterem and pd.scheduled_date in ('2026-10-23','2026-10-26','2026-10-28'));
  perform capture_league_prescriptions(wpg('2026-10-26 12:00'));
  perform capture_league_prescriptions(wpg('2026-10-29 12:00'));
end $$;

-- ===== Mid final week checks (Oct 27 noon) =====
do $$
declare s record; me record; n int;
begin
  perform t_assert((select is_final_week from league_month_scores('2026-10-01', wpg('2026-10-27 12:00')) limit 1), 'Oct 27 is final week');
  perform t_assert(not (select is_final_week from league_month_scores('2026-10-01', wpg('2026-10-24 23:59')) limit 1), 'Oct 24 23:59 is not final week');
  select * into s from league_month_scores('2026-10-01', wpg('2026-10-27 12:00')) where display_name='Three X';
  perform t_assert(s.eligible_workouts=12 and s.completed_eligible=10, 'Three 10/12 on Oct 27 (Oct 28 still ahead)');
  perform t_assert(s.needed_workouts=1 and s.boost_status='chasing' and s.boost_possible, 'Three needs exactly 1, still possible');
  perform t_assert(s.ceiling_points=200, 'ceiling = Five legit 200 (extras excluded, no-bodyweight athlete excluded)');
  perform t_assert(s.projected_match = 200 - (100 + 10) and s.projected_total = s.base_total + 10 + 90, 'Three projected = base + 10 (needed workout) + 90 match');
  perform t_assert(s.adherence_pct = 83.3, 'Three adherence 83.3%');
  select * into s from league_month_scores('2026-10-01', wpg('2026-10-27 12:00')) where display_name='Laterem X';
  perform t_assert(s.eligible_workouts=12 and s.boost_status='out' and not s.boost_possible, 'Laterem: removals after freeze still count; cannot qualify');
  select * into s from league_month_scores('2026-10-01', wpg('2026-10-27 12:00')) where display_name='Gamer X';
  perform t_assert(s.eligible_workouts=12, 'Gamer: deleted past sessions still counted, final-week additions ignored');
end $$;

-- ===== Month end =====
do $$
declare s record; n int;
begin
  perform t_assert((select count(*) from league_month_scores('2026-10-01', wpg('2026-10-31 23:59'))) > 0, 'scores at last minute');
  begin
    perform finalize_league_month('2026-10-01', wpg('2026-10-31 23:00'));
    raise exception 'finalize before month end should fail';
  exception when others then
    if sqlerrm like 'finalize before%' then raise; end if;
    raise notice 'ok: finalize refuses before month end';
  end;
  n := finalize_league_month('2026-10-01', '2026-11-01 06:00+00');
  perform t_assert(n > 0, 'finalize wrote awards ('||n||')');
  n := finalize_league_month('2026-10-01', '2026-11-01 07:00+00');
  perform t_assert(n = 0, 'second finalize writes nothing (no double award)');
  n := finalize_league_month('2026-09-01', '2026-11-01 07:00+00');
  perform t_assert(n = 0, 'months before boost start are never finalized');
end $$;

select a.reason, c.first_name name, a.eligible_workouts el, a.completed_workouts done, a.adherence_pct pct, a.qualified q, a.workout_points wp, a.ceiling_points ceil, a.coverage cov, a.match_points match, a.final_total total
from league_month_awards a join clients c on c.id=a.client_id order by a.final_total desc;

do $$
declare
  function_check int;
  a record;
begin
  for a in select c.first_name n, aw.* from league_month_awards aw join clients c on c.id=aw.client_id loop
    perform t_assert(a.match_points >= 0 and a.final_total >= a.final_total - a.match_points, a.n||' never reduced');
    perform t_assert(a.match_points % 5 = 0 and a.final_total % 5 = 0, a.n||' whole multiples of 5');
  end loop;
  select * into a from league_month_awards aw join clients c on c.id=aw.client_id where c.first_name='Five';
  perform t_assert(a.workout_points=230 and a.match_points=0, 'Five: top athlete gets 0 match; extras still earn their own points');
  select * into a from league_month_awards aw join clients c on c.id=aw.client_id where c.first_name='Three';
  perform t_assert(a.qualified and a.completed_workouts=11 and a.match_points=90, 'Three: 11/12 qualifies, +90 to reach 200');
  select * into a from league_month_awards aw join clients c on c.id=aw.client_id where c.first_name='Gamer';
  perform t_assert(not a.qualified and a.match_points=0 and a.eligible_workouts=12 and a.completed_workouts=10, 'Gamer: deleting misses + adding easy sessions does not qualify');
  select * into a from league_month_awards aw join clients c on c.id=aw.client_id where c.first_name='Injured';
  perform t_assert(a.qualified and a.eligible_workouts=8 and a.match_points=120, 'Injured: coach-removed future sessions excluded, 8/8, +120');
  select * into a from league_month_awards aw join clients c on c.id=aw.client_id where c.first_name='Laterem';
  perform t_assert(not a.qualified and a.match_points=0, 'Laterem: late removals cannot rescue adherence');
  select * into a from league_month_awards aw join clients c on c.id=aw.client_id where c.first_name='Joiner';
  perform t_assert(a.qualified and a.coverage = round(12::numeric/31,4) and a.match_points = 75 - 40, 'Joiner: prorated target 75, +35 (min prorated to 3)');
  select * into a from league_month_awards aw join clients c on c.id=aw.client_id where c.first_name='Mover';
  perform t_assert(a.eligible_workouts=3 and a.completed_workouts=3, 'Mover: moved-within-month counts, moved-out-before-due excluded');
  perform t_assert(not a.qualified and a.match_points=0 and a.reason like 'Fewer than 6%', 'Mover: 3 prescribed is below the 6-workout minimum');
  select * into a from league_month_awards aw join clients c on c.id=aw.client_id where c.first_name='Dupe';
  perform t_assert(a.workout_points=40, 'Dupe: duplicate completion scored once');
  select * into a from league_month_awards aw join clients c on c.id=aw.client_id where c.first_name='Edge';
  perform t_assert(a.workout_points=10 and a.eligible_workouts=2 and a.completed_workouts=1, 'Edge: 23:30 local on the 31st counts; 00:10 on the 1st does not');
  perform t_assert(not exists (select 1 from league_month_awards aw join clients c on c.id=aw.client_id where c.first_name='Nobw' and aw.ceiling_points > 200), 'No-bodyweight athlete never raises the ceiling');
  perform t_assert((select bool_and(not aw.qualified and aw.match_points=0) from league_month_awards aw join clients c on c.id=aw.client_id where c.first_name in ('Tiea','Tieb')), 'A 1-workout month is never matched to the ceiling');
  perform t_assert((select count(distinct rank) from league_month_scores('2026-10-01','2026-11-01 06:00+00') where display_name in ('Tiea X','Tieb X')) = 2, 'Ties get distinct, deterministic ranks');
  perform t_assert((select total_points from league_month_scores('2026-10-01','2026-11-02 00:00+00') where display_name='Three X') = (select final_total from league_month_awards aw join clients c on c.id=aw.client_id where c.first_name='Three'), 'Finalized leaderboard total includes the award');
  perform t_assert((select count(*) from league_month_scores('2026-11-01','2026-11-02 00:00+00') where total_points > 0 and display_name <> 'Edge X') = 0, 'November starts at zero (monthly reset)');
end $$;
