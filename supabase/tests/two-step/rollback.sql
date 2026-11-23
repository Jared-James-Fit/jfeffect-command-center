\set ON_ERROR_STOP 1
set client_min_messages = notice;
\set owner '''00000000-0000-0000-0000-00000000000a'''
\set fin '''00000000-0000-0000-0000-00000000000f'''
\set a1 '''a1000000-0000-0000-0000-000000000001'''
\set f2 '''f2000000-0000-0000-0000-000000000002'''

\i docs/rollback/2026-11-23-two-step-sms-passkeys-rollback.sql

select t_assert(to_regclass('public.two_step_methods') is null and to_regclass('public.two_step_sessions') is null, 'the rollback removes the new tables');
select t_token(:owner, :a1, 'aal1'); set role authenticated;
select t_assert(not has_role(:owner, 'admin'), 'after the rollback the authenticator app is still enforced');
reset role; select t_token(:owner, :a1, 'aal2'); set role authenticated;
select t_assert(has_role(:owner, 'admin'), 'and its aal2 sessions still work');
reset role; select t_token(:fin, :f2, 'aal1'); set role authenticated;
select t_assert(has_role(:fin, 'finance'), 'a login with no authenticator app is as before');
reset role;
select t_assert((select count(*) from staff_mfa_events) > 0, 'the record is kept');
select 'two-step: rolled back cleanly';
