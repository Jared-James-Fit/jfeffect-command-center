-- Cardio workspace: a scheduled change reaches only the workouts from its date, the workout note
-- says the effort in the client's unit, and the new tables are staff-read, server-written.
\set ON_ERROR_STOP 1

-- Marc trains Monday, Wednesday, Friday: workouts this week and next.
insert into pl_blocks (id, client_id) values ('00000000-0000-0000-0000-0000000b10c1', '00000000-0000-0000-0000-0000000c1e01');
insert into pl_weeks (id, block_id) values ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-0000000b10c1');
insert into pl_days (id, week_id, scheduled_date) values
  ('00000000-0000-0000-0000-0000000da001', '00000000-0000-0000-0000-00000000ee01', '2026-11-23'),
  ('00000000-0000-0000-0000-0000000da002', '00000000-0000-0000-0000-00000000ee01', '2026-11-25'),
  ('00000000-0000-0000-0000-0000000da003', '00000000-0000-0000-0000-00000000ee01', '2026-11-30'),
  ('00000000-0000-0000-0000-0000000da004', '00000000-0000-0000-0000-00000000ee01', '2026-12-02');

-- Their training-day walk, 20 minutes, since November 1.
insert into cardio_targets (id, client_id, day_type, cardio_type, duration_minutes, scheduled_weekdays, start_date, source)
values ('00000000-0000-0000-0000-0000000ca001', '00000000-0000-0000-0000-0000000c1e01', 'Training Day', 'Incline Treadmill Walk', 20, '{Monday,Wednesday,Friday}', '2026-11-01', 'coach');
select t_assert((select count(*) from pl_exercise_rows where cardio_target_id = '00000000-0000-0000-0000-0000000ca001' and duration_seconds = 1200) = 4,
  'the walk is the last exercise of every upcoming workout');

-- The coach publishes 30 minutes from next Monday: the 20-minute walk ends Sunday, the new one starts Monday.
update cardio_targets set end_date = '2026-11-29' where id = '00000000-0000-0000-0000-0000000ca001';
insert into cardio_targets (id, client_id, day_type, cardio_type, duration_minutes, scheduled_weekdays, start_date, source,
                            modality, day_rule, timing, rpe_min, rpe_max, speed_min_mph, speed_max_mph, incline, speed_unit)
values ('00000000-0000-0000-0000-0000000ca002', '00000000-0000-0000-0000-0000000c1e01', 'Training Day', 'Incline Treadmill Walk', 30,
        '{Monday,Wednesday,Friday}', '2026-11-30', 'coach', 'treadmill_incline', 'training', 'after_lifting', 3, 4, 3, 3, 6, 'kmh');

select t_assert((select duration_seconds from pl_exercise_rows where day_id = '00000000-0000-0000-0000-0000000da001' and cardio_target_id is not null) = 1200,
  'this Monday keeps the 20-minute walk');
select t_assert((select duration_seconds from pl_exercise_rows where day_id = '00000000-0000-0000-0000-0000000da002' and cardio_target_id is not null) = 1200,
  'this Wednesday keeps the 20-minute walk');
select t_assert((select duration_seconds from pl_exercise_rows where day_id = '00000000-0000-0000-0000-0000000da003' and cardio_target_id = '00000000-0000-0000-0000-0000000ca002') = 1800,
  'next Monday gets the new 30-minute walk');
select t_assert((select duration_seconds from pl_exercise_rows where day_id = '00000000-0000-0000-0000-0000000da004' and cardio_target_id = '00000000-0000-0000-0000-0000000ca002') = 1800,
  'next Wednesday too');
select t_assert((select count(*) from pl_exercise_rows where cardio_target_id is not null) = 4, 'one cardio row a workout, never two');
select t_assert((select notes from pl_exercise_rows where day_id = '00000000-0000-0000-0000-0000000da003' and cardio_target_id is not null) like '%4.8 km/h%',
  'the note says the speed in their unit');
select t_assert((select notes from pl_exercise_rows where day_id = '00000000-0000-0000-0000-0000000da003' and cardio_target_id is not null) like '%RPE 3–4%',
  'and how hard, when there is no heart-rate zone');

-- An old row with none of the new fields reads as it always did.
select t_assert((select notes from pl_exercise_rows where day_id = '00000000-0000-0000-0000-0000000da001' and cardio_target_id is not null) is not null,
  'an older session still has its note');

-- A session that's not a kind of cardio the builder knows is refused.
do $$ begin
  update cardio_targets set modality = 'jogging' where id = '00000000-0000-0000-0000-0000000ca002';
  raise exception 'bad modality accepted';
exception when check_violation then perform t_assert(true, 'only the builder''s kinds of cardio');
end $$;

-- The server records a published version and a draft (as the service role / owner here).
insert into cardio_plan_versions (id, client_id, version_no, sessions, effective_date, state, weekly_minutes, weekly_sessions, change_lines, published_by)
values ('00000000-0000-0000-0000-00000000fe01', '00000000-0000-0000-0000-0000000c1e01', 1, '[]', '2026-11-23', 'scheduled', 90, 3, '{"Walk: 20 → 30 min"}', '00000000-0000-0000-0000-0000000000c1');
insert into cardio_plan_drafts (client_id, sessions, updated_by) values ('00000000-0000-0000-0000-0000000c1e01', '[]', '00000000-0000-0000-0000-0000000000c1');
insert into client_coaching_recommendations (client_id, hash, headline, items) values ('00000000-0000-0000-0000-0000000c1e01', 'h1', 'Keep the current plan', '[]');
insert into cardio_cleo_proposals (client_id, instructions) values ('00000000-0000-0000-0000-0000000c1e01', 'Make it time-efficient');

-- A scheduled version becomes live on its date.
select t_assert(cardio_plan_versions_reach() = 1, 'a scheduled version is live once its date comes');

-- A published version is the record: never rewritten.
do $$ begin
  update cardio_plan_versions set sessions = '[{"minutes": 99}]' where id = '00000000-0000-0000-0000-00000000fe01';
  raise exception 'version rewritten';
exception when insufficient_privilege then perform t_assert(true, 'a published plan can''t be rewritten');
end $$;
update cardio_plan_versions set state = 'replaced' where id = '00000000-0000-0000-0000-00000000fe01';
select t_assert((select state from cardio_plan_versions where id = '00000000-0000-0000-0000-00000000fe01') = 'replaced', 'only its state changes');

set role authenticated;

-- Ana coaches Marc: she reads all of it.
select t_as('00000000-0000-0000-0000-0000000000c1');
select t_assert((select count(*) from cardio_plan_versions) = 1, 'a coach reads their client''s versions');
select t_assert((select count(*) from cardio_plan_drafts) = 1, 'and drafts');
select t_assert((select count(*) from client_coaching_recommendations) = 1, 'and recommendations');
select t_assert((select count(*) from cardio_cleo_proposals) = 1, 'and Cleo''s proposals');

-- But writes nothing herself: the server does, after its own check.
do $$ begin
  insert into cardio_plan_drafts (client_id, sessions) values ('00000000-0000-0000-0000-0000000c1e02', '[]');
  raise exception 'coach wrote a draft';
exception when insufficient_privilege then perform t_assert(true, 'nobody writes a draft but the server');
end $$;
do $$ begin
  update client_coaching_recommendations set status = 'dismissed';
  raise exception 'coach changed a recommendation';
exception when insufficient_privilege then perform t_assert(true, 'nobody decides a recommendation but the server');
end $$;

-- Ben coaches someone else: he sees none of Marc's.
select t_as('00000000-0000-0000-0000-0000000000c2');
select t_assert((select count(*) from cardio_plan_versions) = 0, 'another coach sees none of it');
select t_assert((select count(*) from client_coaching_recommendations) = 0, 'not even the recommendations');

-- The client never sees the coach's working state.
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_assert((select count(*) from cardio_plan_drafts) = 0, 'the client never sees a draft');
select t_assert((select count(*) from cardio_cleo_proposals) = 0, 'or Cleo''s proposals');

-- The owner sees everything.
select t_as('00000000-0000-0000-0000-0000000000a1');
select t_assert((select count(*) from cardio_plan_versions) = 1, 'the owner reads every version');

reset role;
set role anon;
do $$ begin
  perform count(*) from cardio_plan_versions;
  raise exception 'anon read versions';
exception when insufficient_privilege then perform t_assert(true, 'nothing for anonymous callers');
end $$;
reset role;

-- Publishing in one transaction (as the server): Marc's non-training walk, scheduled, then replaced by a publish today.
insert into cardio_targets (id, client_id, day_type, cardio_type, duration_minutes, scheduled_weekdays, start_date, source)
values ('00000000-0000-0000-0000-0000000ca003', '00000000-0000-0000-0000-0000000c1e01', 'Non-Training Day', 'Incline Treadmill Walk', 25, '{Tuesday,Thursday}', '2026-11-01', 'coach');
insert into cardio_completions (client_id, cardio_target_id, completed_date, duration_minutes)
values ('00000000-0000-0000-0000-0000000c1e01', '00000000-0000-0000-0000-0000000ca003', '2026-11-23', 25),
       ('00000000-0000-0000-0000-0000000c1e01', '00000000-0000-0000-0000-0000000ca003', '2026-11-20', 25);

-- scheduled for Dec 1: ends the old one Nov 30, adds the new one from Dec 1
select cardio_plan_publish('00000000-0000-0000-0000-0000000c1e01', jsonb_build_object(
  'effective', '2026-12-01', 'scheduled', true,
  'end', jsonb_build_array(jsonb_build_object('id', '00000000-0000-0000-0000-0000000ca003', 'end_date', '2026-11-30', 'prevEnd', null)),
  'insert', jsonb_build_array(jsonb_build_object('key', 'k1', 'start_date', '2026-12-01', 'replaces', '00000000-0000-0000-0000-0000000ca003',
    'fields', jsonb_build_object('modality', 'bike', 'cardio_type', 'Bike', 'day_type', 'Non-Training Day', 'day_rule', 'non_training',
      'scheduled_weekdays', jsonb_build_array('Tuesday', 'Thursday'), 'frequency_per_week', 2, 'duration_minutes', 30, 'rpe_min', 4, 'rpe_max', 5,
      'progression', jsonb_build_object('kind', 'none', 'step', 0, 'everyWeeks', 1, 'cap', null), 'enabled', true, 'visible_to_client', true))),
  'version', jsonb_build_object('sessions', jsonb_build_array(jsonb_build_object('key', 'k1', 'modality', 'bike', 'minutes', 30)),
    'weekly_minutes', 60, 'weekly_sessions', 2, 'change_lines', jsonb_build_array('Incline walk → Bike'), 'source', 'coach')));
select t_assert((select state from cardio_plan_versions where client_id = '00000000-0000-0000-0000-0000000c1e01' order by version_no desc limit 1) = 'scheduled',
  'a later date is a scheduled version');
select t_assert((select end_date from cardio_targets where id = '00000000-0000-0000-0000-0000000ca003') = '2026-11-30', 'the old walk runs until the day before');
select t_assert((select count(*) from cardio_targets where client_id = '00000000-0000-0000-0000-0000000c1e01' and modality = 'bike' and start_date = '2026-12-01') = 1,
  'the bike starts on its date');
select t_assert((select cardio_target_id from cardio_completions where completed_date = '2026-11-23' and duration_minutes = 25) = '00000000-0000-0000-0000-0000000ca003',
  'a scheduled change leaves today''s logged walk where it is');
select t_assert((select sessions->0->>'id' from cardio_plan_versions where client_id = '00000000-0000-0000-0000-0000000c1e01' order by version_no desc limit 1)
  = (select id::text from cardio_targets where modality = 'bike'), 'the version records the row ids it made');

-- then the coach changes their mind and publishes for today: the waiting change is taken back first
select cardio_plan_publish('00000000-0000-0000-0000-0000000c1e01', jsonb_build_object(
  'effective', '2026-11-23', 'scheduled', false,
  'pending_version_id', (select id from cardio_plan_versions where state = 'scheduled' and client_id = '00000000-0000-0000-0000-0000000c1e01'),
  'revert', jsonb_build_object('deleteIds', (select to_jsonb(created_ids) from cardio_plan_versions where state = 'scheduled' and client_id = '00000000-0000-0000-0000-0000000c1e01'),
                               'restore', jsonb_build_array(jsonb_build_object('id', '00000000-0000-0000-0000-0000000ca003', 'end_date', null))),
  'end', jsonb_build_array(jsonb_build_object('id', '00000000-0000-0000-0000-0000000ca003', 'end_date', '2026-11-22', 'prevEnd', null)),
  'insert', jsonb_build_array(jsonb_build_object('key', 'k2', 'start_date', '2026-11-23', 'replaces', '00000000-0000-0000-0000-0000000ca003',
    'fields', jsonb_build_object('modality', 'treadmill_incline', 'cardio_type', 'Incline Treadmill Walk', 'day_type', 'Non-Training Day',
      'scheduled_weekdays', jsonb_build_array('Tuesday', 'Thursday'), 'frequency_per_week', 2, 'duration_minutes', 35))),
  'version', jsonb_build_object('sessions', jsonb_build_array(jsonb_build_object('key', 'k2', 'minutes', 35)), 'weekly_minutes', 70, 'weekly_sessions', 2)));
select t_assert((select count(*) from cardio_targets where modality = 'bike') = 0, 'the waiting bike is gone');
select t_assert((select state from cardio_plan_versions where version_no = 2 and client_id = '00000000-0000-0000-0000-0000000c1e01') = 'replaced', 'its version says it was replaced');
select t_assert((select end_date from cardio_targets where id = '00000000-0000-0000-0000-0000000ca003') = '2026-11-22', 'the old walk ends yesterday');
select t_assert((select cardio_target_id from cardio_completions where completed_date = '2026-11-23' and duration_minutes = 25)
  = (select id from cardio_targets where duration_minutes = 35), 'today''s logged walk moves with the session');
select t_assert((select cardio_target_id from cardio_completions where completed_date = '2026-11-20') = '00000000-0000-0000-0000-0000000ca003',
  'last week''s stays with what it was logged against');
select t_assert((select count(*) from cardio_plan_drafts where client_id = '00000000-0000-0000-0000-0000000c1e01') = 0, 'publishing clears the draft');

set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  perform cardio_plan_publish('00000000-0000-0000-0000-0000000c1e01', '{"effective": "2026-11-23"}');
  raise exception 'a coach called the publisher directly';
exception when insufficient_privilege then perform t_assert(true, 'only the server publishes');
end $$;
reset role;
