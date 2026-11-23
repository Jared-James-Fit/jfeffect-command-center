\set ON_ERROR_STOP 1
set client_min_messages = notice;
\set owner '''00000000-0000-0000-0000-00000000000a'''
\set a2 '''a2000000-0000-0000-0000-000000000002'''
\set h1 '''1111111111111111111111111111111111111111111111111111111111111111'''

\i docs/rollback/2026-11-23-two-step-email-backup-rollback.sql

select t_assert(to_regprocedure('public.two_step_email_backup_state(uuid)') is null
  and to_regprocedure('public.two_step_code_issue(uuid, uuid, text, text, uuid, text, integer, text)') is null
  and to_regprocedure('public.two_step_code_issue(uuid, uuid, text, text, uuid, text, integer)') is not null,
  'the email rollback puts the texted-codes functions back');
select t_service(); set role service_role;
update two_step_codes set created_at = created_at - interval '1 hour';
select t_assert((two_step_code_issue(:owner, :a2, 'sign_in', '+12045554821', null, :h1) ->> 'ok')::boolean, 'texted codes still work after it');
select t_assert((two_step_code_check(:owner, :a2, 'sign_in', :h1) ->> 'ok')::boolean, 'and check');
reset role;
select 'two-step: email backup rolled back cleanly';
