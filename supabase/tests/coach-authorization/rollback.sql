-- The rollback (docs/rollback/2026-11-22-coach-authorization-rollback.sql)
-- runs cleanly after the migrations and puts the old rules back. Run last.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
reset role;
\i docs/rollback/2026-11-22-coach-authorization-rollback.sql

select t_assert(to_regprocedure('public.cleo_action_target_allowed(uuid,uuid)') is null, 'rolled back: the target check is gone');
select t_assert(not exists (select 1 from information_schema.columns where table_name = 'cleo_actions' and column_name = 'executed_as'), 'rolled back: executed_as is gone');
select t_assert(exists (select 1 from pg_policies where tablename = 'purchase_records' and policyname = 'Coach manage assigned purchase_records' and cmd = 'ALL'), 'rolled back: the coach''s FOR ALL on sales is back');
select t_assert(exists (select 1 from pg_policies where tablename = 'warmup_assignments' and policyname = 'warmup_assignments_admin_coach_all'), 'rolled back: warm-ups as before');
select t_assert((select count(*) = 1 from pg_policies where tablename = 'payment_share_links'), 'rolled back: one payment-link policy, as before');

select t_as('00000000-0000-0000-0000-0000000000c1'); set role authenticated;
select t_assert((select count(*) = 2 from nutrition_ai_plans), 'rolled back: a coach reads every plan again (the old behaviour)');
reset role;
\echo 'coach-authorization: rolled back cleanly'
