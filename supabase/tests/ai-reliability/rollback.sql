\set ON_ERROR_STOP 1
select t_assert(not exists (select 1 from cron.job where jobname = 'ai-health-tick'), 'the tick is gone');
select t_assert(to_regclass('public.ai_call_log') is null and to_regclass('public.ai_provider_health') is null, 'the tables are gone');
select t_assert(to_regprocedure('public.ai_recovery_requeue(integer)') is null, 'and the functions');
delete from net.calls;
insert into community_post_decks (status, priority) values ('pending', 100);
select t_assert(community_post_decks_kick(), 'the deck writer works as it did, with no health table');
select t_assert((select count(*) >= 1 from net.calls), 'and wakes the writer');
select 'ai-reliability: rolled back cleanly';
