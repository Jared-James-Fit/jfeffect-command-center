\set ON_ERROR_STOP 1
do $$
declare me uuid; staff uuid := gen_random_uuid(); n int; r record; d uuid; before_el int; after_el int;
begin
  -- As a client (Three)
  select user_id into me from clients where first_name='Three';
  update auth_ctx set uid = me;
  perform t_assert((select count(*) from get_performance_league('2026-10-01') where is_me) = 1, 'client sees own row');
  perform t_assert((select bool_and(eligible_workouts is null and adherence_pct is null) from get_performance_league('2026-10-01') where not is_me), 'other athletes adherence numbers hidden');
  perform t_assert((select eligible_workouts from get_performance_league('2026-10-01') where is_me) = 12, 'own adherence visible');
  begin perform * from get_league_admin('2026-10-01'); raise exception 'client reached admin';
  exception when others then if sqlerrm = 'client reached admin' then raise; end if; raise notice 'ok: client blocked from admin view'; end;
  begin perform league_excuse_session((select id from clients where first_name='Three'), gen_random_uuid(), 'x', '2026-10-01');  raise exception 'client excused';
  exception when others then if sqlerrm = 'client excused' then raise; end if; raise notice 'ok: client blocked from excusing'; end;
  -- Legacy RPC shape still works, whole points
  perform t_assert((select bool_and(monthly_xp % 5000 = 0) from get_monthly_athlete_rankings(50)), 'legacy RPC totals are whole multiples of 5');
  -- Not signed in
  update auth_ctx set uid = null;
  perform t_assert((select count(*) from get_performance_league('2026-10-01')) = 0, 'signed-out sees nothing');
  -- As staff
  insert into user_roles values (staff, 'coach');
  update auth_ctx set uid = staff;
  perform t_assert((select count(*) from get_league_admin('2026-10-01')) >= 10, 'coach sees admin view');
  perform t_assert((select count(*) from get_league_admin_sessions((select id from clients where first_name='Gamer'), '2026-10-01') where note like 'Added during final week%') = 3, 'admin sees the 3 final-week additions flagged');
  perform t_assert((select count(*) from get_league_admin_sessions((select id from clients where first_name='Gamer'), '2026-10-01') where note like 'Removed after it was due%') = 2, 'admin sees the 2 removed-after-due sessions flagged');
  -- Finalized months cannot be excused
  begin perform league_excuse_session((select id from clients where first_name='Gamer'), (select day_id from league_prescription_snapshots limit 1), 'injury', '2026-10-01'); raise exception 'excused finalized month';
  exception when others then if sqlerrm = 'excused finalized month' then raise; end if; raise notice 'ok: finalized month is locked: %', sqlerrm; end;
  update auth_ctx set uid = null;
end $$;

-- Excuse flow in an OPEN month (November)
do $$
declare staff uuid; c uuid; d uuid; i int; s1 record; s2 record;
begin
  c := t_client('Hurt');
  for i in 1..10 loop d := t_session(c, ('2026-11-02'::date + i)); if i <= 8 then perform t_complete(c, d, wpg(('2026-11-02'::date + i)::text||' 18:00')); end if; end loop;
  perform capture_league_prescriptions(wpg('2026-11-14 12:00'));
  select * into s1 from league_month_scores('2026-11-01', wpg('2026-11-14 12:00')) where client_id = c;
  perform t_assert(s1.eligible_workouts = 10 and s1.completed_eligible = 8 and s1.needed_workouts = 1, 'Hurt: 8/10 needs 1 more');
  select user_id into staff from user_roles where role='coach' limit 1;
  update auth_ctx set uid = staff;
  begin perform league_excuse_session(c, d, '  ', '2026-11-01'); raise exception 'blank reason accepted';
  exception when others then if sqlerrm = 'blank reason accepted' then raise; end if; raise notice 'ok: excuse needs a reason'; end;
  -- excuse both missed sessions (wrist injury): month must be the open one, so pass date explicitly
  perform league_excuse_session(c, (select day_id from league_prescription_snapshots where client_id=c and scheduled_date='2026-11-11'), 'Wrist injury', '2026-11-01');
  perform league_excuse_session(c, (select day_id from league_prescription_snapshots where client_id=c and scheduled_date='2026-11-12'), 'Wrist injury', '2026-11-01');
  update auth_ctx set uid = null;
  select * into s2 from league_month_scores('2026-11-01', wpg('2026-11-14 12:00')) where client_id = c;
  perform t_assert(s2.eligible_workouts = 8 and s2.boost_qualified, 'Hurt: excused sessions removed from target, now 8/8 qualified');
  perform t_assert((select excused_by from league_prescription_snapshots where client_id=c and scheduled_date='2026-11-11') = staff and (select excuse_reason from league_prescription_snapshots where client_id=c and scheduled_date='2026-11-11') = 'Wrist injury', 'excuse recorded with who + why');
end $$;
