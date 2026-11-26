-- The rollback removes the ledger and leaves the app's own fields as they were.
\set ON_ERROR_STOP 1
select t_as_service();
\i docs/rollback/2026-11-26-goal-intelligence-rollback.sql
do $$ begin
  assert to_regclass('public.client_goals') is null, 'client_goals gone';
  assert to_regclass('public.client_update_outbox') is null, 'outbox gone';
  assert to_regprocedure('public.goal_intel_meetings_to_scan(integer)') is null, 'worker queries gone';
  assert not exists (select 1 from pg_trigger where tgname in ('competitions_goal_sync', 'clients_bodyweight_goal_sync', 'program_intel_profiles_goal_sync')), 'sync triggers gone';
  assert (select target_total_kg from competitions where id = '00000000-0000-0000-0000-00000000cc02') = 300, 'competitions untouched';
  assert (select long_term_goal ->> 'text' from program_intel_profiles where client_id = '00000000-0000-0000-0000-0000000000c1') = 'Podium at worlds', 'long-term goal kept';
  -- the app's own fields still take writes
  update competitions set target_total_kg = 305 where id = '00000000-0000-0000-0000-00000000cc02';
  update clients set bodyweight_goal_value = 60 where id = '00000000-0000-0000-0000-0000000000c1';
end $$;
select 'goal-intelligence: rolled back cleanly';
