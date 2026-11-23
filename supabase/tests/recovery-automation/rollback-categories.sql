\set ON_ERROR_STOP 1
reset role;
\i docs/rollback/2026-11-23-coaching-automation-categories-rollback.sql
select t_assert(not exists (select 1 from pg_trigger where tgname in ('workout_feedback_queue_reply', 'messenger_checkin_queue_reply')), 'reviews and check-ins queue nothing');
select t_assert((select count(*) = 0 from coach_automation_items where category not in ('recovery_reply', 'recovery_follow_up')), 'the new kinds are gone from the queue');
select t_assert((select count(*) > 0 from coach_automation_items), 'recovery''s items are still there');
select t_assert(not ((select modes from coach_automation_settings where user_id = '00000000-0000-0000-0000-0000000000a1') ?| array['workout_reply', 'checkin_reply', 'missed_session']), 'settings are back to recovery only');
do $$ begin
  insert into coach_automation_items (coach_user_id, client_id, category, dedupe_key, source_kind)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c1e01', 'workout_reply', 'x', 'workout');
  raise exception 'ASSERT FAILED: a new kind still fits after the rollback';
exception when check_violation then raise notice 'ok: the old categories hold again';
end $$;
select 'coaching-automation-categories: rolled back cleanly';
