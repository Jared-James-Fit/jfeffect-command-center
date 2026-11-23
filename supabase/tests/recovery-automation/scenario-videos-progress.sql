\set ON_ERROR_STOP 1
set client_min_messages = notice;
-- 20270511090000_coaching_automation_videos_progress.sql, after scenario-categories.sql:
-- the owner (every level), Ana (approval queue only), Marc / Devin (the owner's
-- clients, Devin with a check-in rule off), Nico (Ana's), Mia (a JF member).

\set owner '''00000000-0000-0000-0000-0000000000a1'''
\set ana '''00000000-0000-0000-0000-0000000000c1'''
\set fionna '''00000000-0000-0000-0000-0000000000a2'''
\set finance '''00000000-0000-0000-0000-0000000000f1'''
\set marc '''00000000-0000-0000-0000-0000000c1e01'''
\set marc_user '''00000000-0000-0000-0000-00000000d001'''
\set nico '''00000000-0000-0000-0000-0000000c1e02'''
\set nico_user '''00000000-0000-0000-0000-00000000d002'''
\set mia '''00000000-0000-0000-0000-0000000c1e03'''
\set mia_user '''00000000-0000-0000-0000-0000000000e1'''
\set devin '''00000000-0000-0000-0000-0000000c1e05'''
\set devin_user '''00000000-0000-0000-0000-00000000d005'''

reset role; select t_as_service(); set role service_role;
delete from coach_automation_items where category not in ('recovery_reply', 'recovery_follow_up');
delete from coach_automation_client_rules where category <> 'checkin_reply';
reset role;

-- ════ 1. The two kinds that need his eyes never go out by themselves ════════
reset role; select t_as(:owner); set role authenticated;
select coach_automation_settings_set(false, '{"recovery_reply":"approval","workout_reply":"approval","checkin_reply":"approval","missed_session":"approval","video_reply":"approval","progress_reply":"manual"}');
select t_assert((select modes ->> 'video_reply' = 'approval' and modes ->> 'progress_reply' = 'manual' from coach_automation_settings where user_id = :owner), 'the owner sets the two new kinds');
do $$ begin
  perform coach_automation_settings_set(false, '{"video_reply":"automatic"}');
  raise exception 'ASSERT FAILED: a video reply was set to send by itself';
exception when insufficient_privilege then raise notice 'ok: a video reply can never be set to send by itself, even by the owner';
end $$;
do $$ begin
  perform coach_automation_client_rule_set('00000000-0000-0000-0000-0000000c1e01', 'progress_reply', 'automatic');
  raise exception 'ASSERT FAILED: a progress reply rule was set to send by itself';
exception when insufficient_privilege then raise notice 'ok: nor can a client''s rule for progress replies';
end $$;
select coach_automation_client_rule_set(:devin, 'video_reply', 'off');
select t_assert((select mode = 'off' from coach_automation_client_rules where client_id = :devin and category = 'video_reply'), 'a client''s own rule for video replies');
reset role;

reset role; select t_as_service(); set role service_role;
-- a stored "automatic" (from before, or written by hand) is stepped down to asking him
update coach_automation_settings set modes = modes || '{"progress_reply":"automatic"}' where user_id = :owner;
select t_assert(coach_automation_mode_for(:owner, :marc, 'progress_reply') = 'approval', 'a stored automatic progress reply asks him first');
update coach_automation_settings set modes = modes || '{"progress_reply":"manual"}' where user_id = :owner;
select t_assert(coach_automation_mode_for(:ana, :nico, 'video_reply') = 'approval', 'Ana (approval queue only) gets video replies to approve');
select t_assert(coach_automation_mode_for(:owner, :devin, 'video_reply') = 'off', 'Devin''s video replies are off by his rule');
reset role;

-- ════ 2. Workout reviews: every one the client writes is looked at ═════════
reset role; select t_as_service(); set role service_role;
insert into pl_workout_feedback (id, client_id, client_note, overall_rating) values ('00000000-0000-0000-0000-00000000ab01', :marc, null, 5);
select t_assert((select status = 'queued' from coach_automation_items where dedupe_key = 'workout_reply:review:00000000-0000-0000-0000-00000000ab01'), 'a review with no note is queued (the worker decides: a headline PR is worth a reply)');
set t.coach_pov = 'on';
insert into pl_workout_feedback (id, client_id, client_note, overall_rating) values ('00000000-0000-0000-0000-00000000ab02', :marc, null, 5);
set t.coach_pov = 'off';
select t_assert(not exists (select 1 from coach_automation_items where source_id = '00000000-0000-0000-0000-00000000ab02'), 'still never one a coach wrote for them');

-- a changed note has a waiting reply written again; a changed rating alone doesn't
update coach_automation_items set status = 'awaiting_approval', draft = 'big squat today' where source_id = '00000000-0000-0000-0000-00000000ab01';
update pl_workout_feedback set overall_rating = 4 where id = '00000000-0000-0000-0000-00000000ab01';
select t_assert((select status = 'awaiting_approval' from coach_automation_items where source_id = '00000000-0000-0000-0000-00000000ab01'), 'a rating change leaves the waiting reply as it is');
update pl_workout_feedback set client_note = 'knees felt good, should I go up next week?' where id = '00000000-0000-0000-0000-00000000ab01';
select t_assert((select status = 'queued' and due_at > now() + interval '2 minutes' from coach_automation_items where source_id = '00000000-0000-0000-0000-00000000ab01'), 'a note they add to a waiting reply has it written again');
update coach_automation_items set status = 'sending' where source_id = '00000000-0000-0000-0000-00000000ab01';
update pl_workout_feedback set client_note = 'nvm' where id = '00000000-0000-0000-0000-00000000ab01';
select t_assert((select status = 'sending' from coach_automation_items where source_id = '00000000-0000-0000-0000-00000000ab01'), 'never one already taken for sending');
reset role;

-- ════ 3. Set videos: one reply for the day's videos ═════════════════════════
reset role; select t_as_service(); set role service_role;
-- as set_video_attach does it: the row, then its message, then the row gets the message
insert into pl_set_videos (id, client_id) values ('00000000-0000-0000-0000-00000000bb01', :marc);
select t_assert(not exists (select 1 from coach_automation_items where category = 'video_reply'), 'nothing until the video''s message is in');
insert into messages (id, client_id, sender_id, sender_role, body) values ('00000000-0000-0000-0000-00000000bf01', :marc, :marc_user, 'client', 'Competition Squat · Top set');
update pl_set_videos set message_id = '00000000-0000-0000-0000-00000000bf01' where id = '00000000-0000-0000-0000-00000000bb01';
select t_assert((select count(*) = 1 from coach_automation_items where category = 'video_reply' and client_id = :marc), 'a set video the client sent queues a reply');
select t_assert((select status = 'queued' and source_kind = 'video' and due_at > now() + interval '25 minutes' and context ? 'day'
                   and dedupe_key = 'video_reply:' || :marc || ':' || (context ->> 'day') from coach_automation_items where category = 'video_reply'),
                'keyed by the client and the day, 30 quiet minutes first');

update coach_automation_items set status = 'awaiting_approval', due_at = now() where category = 'video_reply';
insert into messages (id, client_id, sender_id, sender_role, body) values ('00000000-0000-0000-0000-00000000bf02', :marc, :marc_user, 'client', 'Competition Squat · Backoff');
insert into pl_set_videos (id, client_id, message_id) values ('00000000-0000-0000-0000-00000000bb02', :marc, '00000000-0000-0000-0000-00000000bf02');
select t_assert((select count(*) = 1 from coach_automation_items where category = 'video_reply' and client_id = :marc), 'the day''s second video joins the same reply');
select t_assert((select status = 'queued' and due_at > now() + interval '25 minutes' from coach_automation_items where category = 'video_reply' and client_id = :marc), 'and has a waiting one written again with it, 30 minutes after it');

update coach_automation_items set status = 'sent' where category = 'video_reply';
insert into messages (id, client_id, sender_id, sender_role, body) values ('00000000-0000-0000-0000-00000000bf03', :marc, :marc_user, 'client', 'Bench · Set 3');
insert into pl_set_videos (client_id, message_id) values (:marc, '00000000-0000-0000-0000-00000000bf03');
select t_assert((select status = 'sent' from coach_automation_items where category = 'video_reply' and client_id = :marc), 'never one already sent');

-- what never queues
insert into messages (id, client_id, sender_id, sender_role, body) values ('00000000-0000-0000-0000-00000000bf04', :devin, :owner, 'admin', 'filmed for him');
insert into pl_set_videos (client_id, message_id) values (:devin, '00000000-0000-0000-0000-00000000bf04');
insert into messages (id, client_id, sender_id, sender_role, body, created_at) values ('00000000-0000-0000-0000-00000000bf05', :nico, :nico_user, 'client', 'old one', now() - interval '2 days');
insert into pl_set_videos (client_id, message_id) values (:nico, '00000000-0000-0000-0000-00000000bf05');
insert into messages (id, client_id, sender_id, sender_role, body) values ('00000000-0000-0000-0000-00000000bf06', :nico, :nico_user, 'client', 'removed');
insert into pl_set_videos (client_id, message_id, deleted_at) values (:nico, '00000000-0000-0000-0000-00000000bf06', now());
insert into messages (id, client_id, sender_id, sender_role, body) values ('00000000-0000-0000-0000-00000000bf07', :mia, :mia_user, 'client', 'a member');
insert into pl_set_videos (client_id, message_id) values (:mia, '00000000-0000-0000-0000-00000000bf07');
select t_assert(not exists (select 1 from coach_automation_items where category = 'video_reply' and client_id in (:devin, :nico, :mia)),
                'never a video a coach sent for them, one from days ago, one removed, or a member''s');

-- Ana's client: hers to approve
insert into messages (id, client_id, sender_id, sender_role, body) values ('00000000-0000-0000-0000-00000000bf08', :nico, :nico_user, 'client', 'Deadlift · Top set');
insert into pl_set_videos (client_id, message_id) values (:nico, '00000000-0000-0000-0000-00000000bf08');
select t_assert((select coach_user_id = :ana from coach_automation_items where category = 'video_reply' and client_id = :nico), 'Ana''s client''s video is hers');

-- paused: nothing
reset role; select t_as(:ana); set role authenticated;
select coach_automation_settings_set(true, '{"video_reply":"approval"}');
reset role; select t_as_service(); set role service_role;
delete from coach_automation_items where client_id = :nico;
insert into messages (id, client_id, sender_id, sender_role, body) values ('00000000-0000-0000-0000-00000000bf09', :nico, :nico_user, 'client', 'Deadlift · Backoff');
insert into pl_set_videos (client_id, message_id) values (:nico, '00000000-0000-0000-0000-00000000bf09');
select t_assert(not exists (select 1 from coach_automation_items where client_id = :nico), 'paused queues no video reply');
reset role; select t_as(:ana); set role authenticated;
select coach_automation_settings_set(false, '{"video_reply":"approval"}');
reset role;

-- ════ 4. Progress check-ins ═════════════════════════════════════════════════
reset role; select t_as_service(); set role service_role;
insert into progress_submissions (id, client_id, user_id, review_status) values ('00000000-0000-0000-0000-00000000dd01', :marc, :marc_user, 'draft');
select t_assert(not exists (select 1 from coach_automation_items where category = 'progress_reply'), 'a draft queues nothing');
update progress_submissions set review_status = 'awaiting_review', submitted_at = now() where id = '00000000-0000-0000-0000-00000000dd01';
select t_assert((select status = 'queued' and source_kind = 'progress' and due_at > now() + interval '5 minutes' from coach_automation_items
                  where dedupe_key = 'progress_reply:00000000-0000-0000-0000-00000000dd01'), 'sending it for review queues its reply, ten quiet minutes first');
update progress_submissions set submitted_at = now() where id = '00000000-0000-0000-0000-00000000dd01';
select t_assert((select count(*) = 1 from coach_automation_items where category = 'progress_reply'), 'once per check-in');

update coach_automation_items set status = 'awaiting_approval' where category = 'progress_reply';
update progress_submissions set review_status = 'reviewed', reviewed_at = now() where id = '00000000-0000-0000-0000-00000000dd01';
select t_assert((select status = 'cancelled' from coach_automation_items where category = 'progress_reply'), 'reviewing it himself cancels its waiting reply');
select t_assert(exists (select 1 from coach_automation_events e join coach_automation_items i on i.id = e.item_id where i.category = 'progress_reply' and e.kind = 'cancelled'), 'on the record');

insert into progress_submissions (client_id, user_id, review_status, submitted_at) values (:devin, :owner, 'awaiting_review', now());
insert into progress_submissions (client_id, user_id, owner_type, review_status, submitted_at) values (:mia, :mia_user, 'member', 'awaiting_review', now());
insert into progress_submissions (client_id, user_id, review_status, submitted_at) values (:devin, :devin_user, 'awaiting_review', now() - interval '3 days');
select t_assert(not exists (select 1 from coach_automation_items where category = 'progress_reply' and client_id in (:devin, :mia)),
                'never one a coach uploaded for them, a member''s, or one sent days ago');
reset role;

-- ════ 5. My Voice is the owner's ═══════════════════════════════════════════
reset role; select t_as(:owner); set role authenticated;
select t_assert((select count(*) = 1 from coach_voice), 'the owner reads his voice');
select t_mfa(false);
select t_assert((select count(*) = 0 from coach_voice), 'not without his two-step sign-in');
reset role; select t_as(:ana); set role authenticated;
select t_assert((select count(*) = 0 from coach_voice), 'a coach can''t read the owner''s voice');
reset role; select t_as(:fionna); set role authenticated;
select t_assert((select count(*) = 0 from coach_voice), 'nor can a second admin');
reset role; select t_as(:finance); set role authenticated;
select t_assert((select count(*) = 0 from coach_voice), 'nor the finance login');
reset role;

select 'coaching-automation-videos-progress: all assertions passed';
