\set ON_ERROR_STOP 1
reset role;
\i docs/rollback/2026-11-22-recovery-automation-rollback.sql
select t_assert(to_regclass('public.coach_automation_items') is null and to_regclass('public.cleo_features') is null, 'the queue and the levels are gone');
select t_assert(not exists (select 1 from pg_trigger where tgname = 'pain_reports_queue_reply'), 'pain reports queue nothing');
select t_assert((select count(*) = 7 from pain_reports), 'every pain report is still there');
select 'recovery-automation: rolled back cleanly';
