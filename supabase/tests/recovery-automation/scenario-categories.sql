\set ON_ERROR_STOP 1
set client_min_messages = notice;
-- 20270510090000_coaching_automation_categories.sql, after scenario.sql: the owner
-- (every level), Ana (an active coach with only the approval queue left: her
-- auto-send was revoked and her follow-ups ran out), Marc / Devin (the owner's
-- clients), Nico (Ana's), Mia (a JF member), Old (the owner's, archived).

\set owner '''00000000-0000-0000-0000-0000000000a1'''
\set ana '''00000000-0000-0000-0000-0000000000c1'''
\set fionna '''00000000-0000-0000-0000-0000000000a2'''
\set mia_user '''00000000-0000-0000-0000-0000000000e1'''
\set marc '''00000000-0000-0000-0000-0000000c1e01'''
\set nico '''00000000-0000-0000-0000-0000000c1e02'''
\set mia '''00000000-0000-0000-0000-0000000c1e03'''
\set old '''00000000-0000-0000-0000-0000000c1e04'''
\set devin '''00000000-0000-0000-0000-0000000c1e05'''

-- ════ 1. Settings for the new kinds, within each level ═══════════════════════
reset role; select t_as(:owner); set role authenticated;
select coach_automation_settings_set(false, '{"recovery_reply":"approval","workout_reply":"automatic","checkin_reply":"approval","missed_session":"approval"}');
select t_assert((select modes ->> 'workout_reply' = 'automatic' and modes ->> 'missed_session' = 'approval' from coach_automation_settings), 'the owner sets every kind');
do $$ begin
  perform coach_automation_settings_set(false, '{"made_up":"approval"}');
  raise exception 'ASSERT FAILED: an unknown kind was saved';
exception when invalid_parameter_value then raise notice 'ok: an unknown kind is refused';
end $$;
select coach_automation_client_rule_set(:devin, 'checkin_reply', 'off');
select t_assert((select mode = 'off' from coach_automation_client_rules where client_id = :devin and category = 'checkin_reply'), 'a client''s own rule for a new kind');
reset role;

reset role; select t_as(:ana); set role authenticated;
select coach_automation_settings_set(false, '{"workout_reply":"approval"}');
select t_assert(true, 'Ana (approval queue only) asks first for workout replies');
do $$ begin
  perform coach_automation_settings_set(false, '{"workout_reply":"automatic"}');
  raise exception 'ASSERT FAILED: Ana sent automatically without auto-send';
exception when insufficient_privilege then raise notice 'ok: sending by itself needs auto-send, whatever the kind';
end $$;
do $$ begin
  perform coach_automation_settings_set(false, '{"missed_session":"approval"}');
  raise exception 'ASSERT FAILED: Ana started outreach without follow-ups';
exception when insufficient_privilege then raise notice 'ok: a missed-session check-in needs follow-ups (outreach the client didn''t start)';
end $$;
do $$ begin
  perform coach_automation_client_rule_set('00000000-0000-0000-0000-0000000c1e01', 'workout_reply', 'approval');
  raise exception 'ASSERT FAILED: Ana set a rule on the owner''s client';
exception when insufficient_privilege then raise notice 'ok: a rule only for her own clients';
end $$;
reset role;

reset role; select t_as_service(); set role service_role;
select t_assert(coach_automation_mode_for(:owner, :marc, 'missed_session') = 'approval', 'the owner''s missed sessions ask him first');
select t_assert(coach_automation_mode_for(:ana, :nico, 'missed_session') = 'off', 'Ana''s missed sessions are off (no follow-ups in her plan)');
select t_assert(coach_automation_mode_for(:owner, :marc, 'workout_reply') = 'automatic', 'the owner''s routine workout replies may go by themselves');
select t_assert(coach_automation_mode_for(:ana, :nico, 'workout_reply') = 'approval', 'Ana''s wait for her');
reset role;

-- ════ 2. Workout reviews ═════════════════════════════════════════════════════
reset role; select t_as_service(); set role service_role;
insert into pl_workout_feedback (id, client_id, client_note, overall_rating) values ('00000000-0000-0000-0000-00000000aa01', :marc, 'felt strong today, bar speed was there on the top set', 4);
select t_assert((select count(*) = 1 and min(status) = 'queued' and min(source_kind) = 'workout' from coach_automation_items where dedupe_key = 'workout_reply:review:00000000-0000-0000-0000-00000000aa01'), 'a review with a note queues one reply');
update pl_workout_feedback set client_note = 'felt strong today, bar speed was there on the top set. legs cooked' where id = '00000000-0000-0000-0000-00000000aa01';
select t_assert((select count(*) = 1 from coach_automation_items where category = 'workout_reply' and client_id = :marc), 'editing it never queues a second');
insert into pl_workout_feedback (client_id, overall_rating) values (:marc, 4);
select t_assert((select count(*) = 1 from coach_automation_items where category = 'workout_reply' and client_id = :marc), 'a review with nothing to say queues nothing');
insert into pl_workout_feedback (id, client_id, overall_rating) values ('00000000-0000-0000-0000-00000000aa02', :marc, 2);
select t_assert((select count(*) = 1 from coach_automation_items where source_id = '00000000-0000-0000-0000-00000000aa02'), 'a session rated 2/5 queues a reply');
insert into pl_workout_feedback (client_id, client_note, overall_rating, pain) values (:marc, 'knee was off', 3, true);
select t_assert((select count(*) = 2 from coach_automation_items where category = 'workout_reply' and client_id = :marc), 'a review with pain is recovery''s, never a workout reply too');
insert into pl_workout_feedback (client_id, client_note, overall_rating, created_at) values (:marc, 'old one saved again', 4, now() - interval '3 days');
select t_assert((select count(*) = 2 from coach_automation_items where category = 'workout_reply' and client_id = :marc), 'an old review queues nothing');
insert into pl_workout_feedback (client_id, client_note) values (:old, 'archived client'), (:mia, 'a member, no coach');
select t_assert((select count(*) = 0 from coach_automation_items where client_id in (:old, :mia)), 'an archived client or a member gets nothing');
insert into pl_workout_feedback (client_id, client_note) values (:nico, 'deadlifts moved well');
select t_assert((select count(*) = 1 and min(coach_user_id::text) = :ana from coach_automation_items where category = 'workout_reply' and client_id = :nico), 'Ana''s own client queues for her');
reset role;

-- ════ 3. Weekly check-ins ════════════════════════════════════════════════════
reset role; select t_as_service(); set role service_role;
insert into messenger_checkins (id, client_id, status, ai_status, submitted_at) values ('00000000-0000-0000-0000-00000000cc11', :marc, 'completed', 'pending', now());
select t_assert((select count(*) = 0 from coach_automation_items where category = 'checkin_reply'), 'nothing until its recap is written');
update messenger_checkins set ai_status = 'ready' where id = '00000000-0000-0000-0000-00000000cc11';
select t_assert((select count(*) = 1 from coach_automation_items where dedupe_key = 'checkin_reply:00000000-0000-0000-0000-00000000cc11'), 'its recap being ready queues one reply');
update messenger_checkins set ai_status = 'pending' where id = '00000000-0000-0000-0000-00000000cc11';
update messenger_checkins set ai_status = 'ready' where id = '00000000-0000-0000-0000-00000000cc11';
select t_assert((select count(*) = 1 from coach_automation_items where category = 'checkin_reply'), 'a Redo never queues a second');
insert into messenger_checkins (client_id, status, ai_status, submitted_at, reviewed_at) values (:marc, 'completed', 'pending', now(), now());
update messenger_checkins set ai_status = 'ready' where client_id = :marc and reviewed_at is not null;
select t_assert((select count(*) = 1 from coach_automation_items where category = 'checkin_reply'), 'one he already replied to queues nothing');
insert into messenger_checkins (client_id, status, ai_status, submitted_at) values (:marc, 'completed', 'pending', now() - interval '4 days');
update messenger_checkins set ai_status = 'ready' where client_id = :marc and submitted_at < now() - interval '3 days';
select t_assert((select count(*) = 1 from coach_automation_items where category = 'checkin_reply'), 'an old check-in queues nothing');
insert into messenger_checkins (client_id, status, ai_status, submitted_at) values (:devin, 'completed', 'pending', now());
update messenger_checkins set ai_status = 'ready' where client_id = :devin;
select t_assert((select count(*) = 0 from coach_automation_items where category = 'checkin_reply' and client_id = :devin), 'a client whose rule is off queues nothing');
reset role;

-- Pause stops the new kinds too.
reset role; select t_as(:owner); set role authenticated;
select coach_automation_settings_set(true, '{"workout_reply":"automatic"}');
reset role;
reset role; select t_as_service(); set role service_role;
insert into pl_workout_feedback (client_id, client_note) values (:devin, 'paused, so nothing');
select t_assert((select count(*) = 0 from coach_automation_items where category = 'workout_reply' and client_id = :devin), 'paused queues nothing of any kind');
reset role;

-- ════ 4. Who reads them ══════════════════════════════════════════════════════
reset role; select t_as(:ana); set role authenticated;
select t_assert((select count(*) > 0 and bool_and(client_id = :nico) from coach_automation_items), 'Ana still reads only her own');
reset role;
reset role; select t_as(:fionna); set role authenticated;
select t_assert((select count(*) = 0 from coach_automation_items), 'a second admin still reads none of the owner''s');
reset role;
reset role; select t_as(:mia_user); set role authenticated;
select t_assert((select count(*) = 0 from coach_automation_items), 'a member reads nothing');
reset role;

-- ════ 5. Missed sessions are the worker's to queue ══════════════════════════
reset role; select t_as_service(); set role service_role;
insert into coach_automation_items (coach_user_id, client_id, category, dedupe_key, source_kind, status)
values (:owner, :marc, 'missed_session', 'missed_session:' || :marc || ':2026-11-22', 'missed', 'queued');
select t_assert((select count(*) = 1 from coach_automation_items where category = 'missed_session'), 'the worker queues a missed session');
do $$ begin
  insert into coach_automation_items (coach_user_id, client_id, category, dedupe_key, source_kind, status)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c1e01', 'missed_session', 'missed_session:00000000-0000-0000-0000-0000000c1e01:2026-11-22', 'missed', 'queued');
  raise exception 'ASSERT FAILED: the same missed day was queued twice';
exception when unique_violation then raise notice 'ok: once per missed day';
end $$;
reset role;
reset role; select t_as(:ana); set role authenticated;
do $$ begin
  insert into coach_automation_items (coach_user_id, client_id, category, dedupe_key, source_kind)
  values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000c1e02', 'missed_session', 'x', 'missed');
  raise exception 'ASSERT FAILED: a coach wrote to the queue';
exception when insufficient_privilege then raise notice 'ok: only the server writes the queue';
end $$;
reset role;

-- ════ 6. Only the client's own words, and an approval closes only what it answers ═══
reset role; select t_as(:owner); set role authenticated;
select coach_automation_settings_set(false, '{"recovery_reply":"approval","workout_reply":"approval","checkin_reply":"approval"}');
reset role;
reset role; select t_as_service(); set role service_role;
set t.coach_pov = 'on';
insert into pl_workout_feedback (client_id, client_note) values (:devin, 'logged from his paper sheet, felt heavy');
select t_assert((select count(*) = 0 from coach_automation_items where category = 'workout_reply' and client_id = :devin), 'a review a coach wrote in View as client queues nothing');
insert into pain_reports (client_id, feedback_id, source, region) values (:devin, '00000000-0000-0000-0000-00000000fb21', 'review', 'knee');
select t_assert((select count(*) = 0 from coach_automation_items where dedupe_key like '%fb21'), 'nor does a pain report a coach saved for them');
reset t.coach_pov;
insert into pl_workout_feedback (id, client_id, client_note) values ('00000000-0000-0000-0000-00000000aa21', :devin, 'ok');
select t_assert((select count(*) = 1 from coach_automation_items where source_id = '00000000-0000-0000-0000-00000000aa21'), 'their own short note is queued for the worker to judge');
update coach_automation_items set status = 'cancelled', context = '{"not_useful": true}' where source_id = '00000000-0000-0000-0000-00000000aa21';
update pl_workout_feedback set client_note = 'ok but should I keep the same weight next week?' where id = '00000000-0000-0000-0000-00000000aa21';
select t_assert((select status = 'queued' and context is null from coach_automation_items where source_id = '00000000-0000-0000-0000-00000000aa21'), 'one with nothing to reply to is looked at again when they add to it');
update coach_automation_items set status = 'cancelled', context = null, why = 'you''ve written to them since' where source_id = '00000000-0000-0000-0000-00000000aa21';
update pl_workout_feedback set client_note = 'ok but should I keep the same weight next week? also legs cooked' where id = '00000000-0000-0000-0000-00000000aa21';
select t_assert((select status = 'cancelled' from coach_automation_items where source_id = '00000000-0000-0000-0000-00000000aa21'), 'one cancelled for any other reason stays cancelled');

insert into messenger_checkins (client_id, task_type, status, ai_status, submitted_at) values (:marc, 'nutrition_review', 'completed', 'pending', now());
update messenger_checkins set ai_status = 'ready' where task_type = 'nutrition_review';
select t_assert((select count(*) = 0 from coach_automation_items where category = 'checkin_reply' and client_id = :marc and source_id <> '00000000-0000-0000-0000-00000000cc11'), 'only weekly check-ins get a reply');

update messenger_checkins set reviewed_at = now() where id = '00000000-0000-0000-0000-00000000cc11';
select t_assert((select status = 'cancelled' from coach_automation_items where dedupe_key = 'checkin_reply:00000000-0000-0000-0000-00000000cc11'), 'replying to a check-in himself cancels its waiting reply');

reset role;
create trigger staff_reply_closes_reviews after insert on messages for each row execute function tg_staff_reply_closes_reviews();
set role service_role;
insert into messenger_checkins (id, client_id, status, ai_status, submitted_at) values ('00000000-0000-0000-0000-00000000cc31', :marc, 'completed', 'pending', now() - interval '1 hour');
insert into messages (client_id, sender_id, sender_role, body, attachments)
values (:marc, :owner, 'admin', 'nice pull today', '[{"kind": "recovery_auto", "category": "workout_reply", "automatic": false}]');
select t_assert((select reviewed_at is null from messenger_checkins where id = '00000000-0000-0000-0000-00000000cc31'), 'approving a workout reply leaves his check-in waiting');
insert into messages (client_id, sender_id, sender_role, body, attachments)
values (:marc, :owner, 'admin', 'good week', '[{"kind": "recovery_auto", "category": "checkin_reply", "automatic": false}]');
select t_assert((select reviewed_at is not null and reviewed_via = 'reply' from messenger_checkins where id = '00000000-0000-0000-0000-00000000cc31'), 'approving the check-in''s reply closes it');
insert into messenger_checkins (id, client_id, status, ai_status, submitted_at) values ('00000000-0000-0000-0000-00000000cc32', :marc, 'completed', 'pending', now() - interval '1 hour');
insert into messages (client_id, sender_id, sender_role, body) values (:marc, :owner, 'admin', 'typed by hand');
select t_assert((select reviewed_at is not null from messenger_checkins where id = '00000000-0000-0000-0000-00000000cc32'), 'a reply he types himself still closes it, as before');
reset role;

select 'coaching-automation-categories: all assertions passed';
