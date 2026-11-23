\set ON_ERROR_STOP 1
reset role;
\i docs/rollback/2026-11-23-coaching-automation-videos-progress-rollback.sql
select t_assert(not exists (select 1 from pg_trigger where tgname in ('pl_set_videos_queue_reply', 'progress_submissions_queue_reply', 'progress_submissions_reviewed_cancels_reply')), 'videos and progress check-ins queue nothing');
select t_assert((select count(*) = 0 from coach_automation_items where category in ('video_reply', 'progress_reply')), 'their items are gone from the queue');
select t_assert(not ((select modes from coach_automation_settings where user_id = '00000000-0000-0000-0000-0000000000a1') ?| array['video_reply', 'progress_reply']), 'and from the settings');
do $$ begin
  insert into coach_automation_items (coach_user_id, client_id, category, dedupe_key, source_kind)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c1e01', 'video_reply', 'x', 'video');
  raise exception 'ASSERT FAILED: a video reply still fits after the rollback';
exception when check_violation then raise notice 'ok: the five kinds hold again';
end $$;
select t_assert(position('v_note_changed' in pg_get_functiondef('tg_workout_feedback_queue_reply'::regproc)) = 0, 'the workout trigger is back to notes and low ratings');
select t_as_service(); set role service_role;
insert into pl_workout_feedback (id, client_id, client_note, overall_rating) values ('00000000-0000-0000-0000-00000000ab09', '00000000-0000-0000-0000-0000000c1e01', null, 5);
select t_assert(not exists (select 1 from coach_automation_items where source_id = '00000000-0000-0000-0000-00000000ab09'), 'a review with nothing to say queues nothing again');
reset role; select t_as('00000000-0000-0000-0000-0000000000c1'); set role authenticated;
select t_assert((select count(*) = 1 from coach_voice), 'every coach reads My Voice again, as before');
reset role;
select 'coaching-automation-videos-progress: rolled back cleanly';
