\set ON_ERROR_STOP 1
select t_assert(to_regclass('public.app_sessions') is null, 'visits table gone');
select t_assert(to_regprocedure('public.ai_background_held()') is null, 'hold function gone');
select t_assert(to_regprocedure('public.community_post_decks_kick()') is not null, 'deck kick still there');
select t_assert(to_regprocedure('public.membership_overview(integer)') is null, 'membership read gone');
select 'ok: rolled back';
