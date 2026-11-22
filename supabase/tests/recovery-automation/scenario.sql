\set ON_ERROR_STOP 1
set client_min_messages = notice;

\set owner '''00000000-0000-0000-0000-0000000000a1'''
\set fionna '''00000000-0000-0000-0000-0000000000a2'''
\set ana '''00000000-0000-0000-0000-0000000000c1'''
\set ben '''00000000-0000-0000-0000-0000000000c2'''
\set fin '''00000000-0000-0000-0000-0000000000f1'''
\set mia_user '''00000000-0000-0000-0000-0000000000e1'''
\set marc '''00000000-0000-0000-0000-0000000c1e01'''
\set nico '''00000000-0000-0000-0000-0000000c1e02'''
\set mia '''00000000-0000-0000-0000-0000000c1e03'''
\set old '''00000000-0000-0000-0000-0000000c1e04'''
\set devin '''00000000-0000-0000-0000-0000000c1e05'''

-- ════ 1. Capability levels ═══════════════════════════════════════════════════
reset role; select t_as_service(); set role service_role;
select t_assert((select bool_and(cleo_has_feature(:owner, key)) from cleo_features), 'the owner has every capability');
select t_assert(cleo_has_feature(:ana, 'assist.message_drafts') and cleo_has_feature(:ana, 'assist.recovery_analysis'), 'an active coach has Assist');
select t_assert(not cleo_has_feature(:ana, 'automation.approval_queue') and not cleo_has_feature(:ana, 'automation.auto_send'), 'a coach has no automation without a grant');
select t_assert(not cleo_has_feature(:ana, 'owner.voice') and not cleo_has_feature(:ana, 'owner.controls'), 'a coach never has an owner capability');
select t_assert(not cleo_has_feature(:ben, 'assist.message_drafts'), 'a suspended coach has nothing');
select t_assert(cleo_has_feature(:fionna, 'assist.message_drafts') and not cleo_has_feature(:fionna, 'owner.voice') and not cleo_has_feature(:fionna, 'automation.auto_send'), 'a second admin who isn''t the owner has Assist only');
select t_assert(not cleo_has_feature(:fin, 'assist.message_drafts') and not cleo_has_feature(:mia_user, 'assist.message_drafts'), 'the finance login and a member have nothing');
select t_assert(not cleo_has_feature(:owner, 'owner.made_up'), 'an unknown capability is no capability');
select t_assert(not cleo_has_feature(null, 'assist.message_drafts'), 'nobody has nothing');

-- An owner capability can never be granted, by anyone, the server included.
do $$ begin
  insert into cleo_entitlement_grants (user_id, feature_key, source) values ('00000000-0000-0000-0000-0000000000c1', 'owner.voice', 'plan');
  raise exception 'ASSERT FAILED: an owner capability was granted';
exception when insufficient_privilege then raise notice 'ok: owner capabilities are never grants';
end $$;
reset role;

-- The owner grants Ana the paid tier (as a future plan would): she gets it, never the owner level.
reset role; select t_as(:owner); set role authenticated;
select t_assert(cleo_feature('owner.controls'), 'the owner, signed in with their code, has owner controls');
select cleo_entitlement_grant(:ana, 'automation.approval_queue', 'plan');
select cleo_entitlement_grant(:ana, 'automation.auto_send', 'plan');
select cleo_entitlement_grant(:ana, 'automation.follow_ups', 'plan');
select t_assert((cleo_capability_overview() -> 'grants') is not null, 'the owner reads the overview');
do $$ begin
  perform cleo_entitlement_grant('00000000-0000-0000-0000-0000000000c1', 'owner.training_aware', 'promo');
  raise exception 'ASSERT FAILED: the owner granted an owner capability';
exception when insufficient_privilege then raise notice 'ok: not even the owner can grant the owner level';
end $$;
do $$ begin
  perform cleo_entitlement_grant('00000000-0000-0000-0000-0000000000e1', 'automation.auto_send', 'promo');
  raise exception 'ASSERT FAILED: a member got automation';
exception when invalid_parameter_value then raise notice 'ok: capabilities go to coaches only';
end $$;
-- Without the code, nothing owner-level.
select t_mfa(false);
select t_assert(not cleo_feature('owner.controls'), 'no owner controls before the second step');
do $$ begin
  perform cleo_capability_overview();
  raise exception 'ASSERT FAILED: the overview opened without the code';
exception when insufficient_privilege then raise notice 'ok: the overview needs the code';
end $$;
select t_mfa(true);
reset role;

reset role; select t_as_service(); set role service_role;
select t_assert(cleo_has_feature(:ana, 'automation.auto_send'), 'Ana''s plan gives her automatic sending');
select t_assert(not cleo_has_feature(:ana, 'owner.voice') and not cleo_has_feature(:ana, 'owner.training_aware') and not cleo_has_feature(:ana, 'owner.controls'), 'every paid capability still leaves the owner level out');
select t_assert((select count(*) = 3 from coach_automation_events where kind = 'capability_granted'), 'each grant is on the record');
reset role;

-- Ana can't grant herself anything, read the overview or touch grants directly.
reset role; select t_as(:ana); set role authenticated;
do $$ begin
  perform cleo_entitlement_grant('00000000-0000-0000-0000-0000000000c1', 'automation.auto_send', 'account');
  raise exception 'ASSERT FAILED: a coach granted herself a capability';
exception when insufficient_privilege then raise notice 'ok: a coach can''t grant herself';
end $$;
do $$ begin
  perform cleo_capability_overview();
  raise exception 'ASSERT FAILED: a coach read the overview';
exception when insufficient_privilege then raise notice 'ok: the overview is the owner''s';
end $$;
do $$ begin
  insert into cleo_entitlement_grants (user_id, feature_key, source) values ('00000000-0000-0000-0000-0000000000c1', 'automation.auto_send', 'account');
  raise exception 'ASSERT FAILED: a coach wrote a grant';
exception when insufficient_privilege then raise notice 'ok: grants aren''t writable from the app';
end $$;
do $$ begin
  perform cleo_has_feature('00000000-0000-0000-0000-0000000000a1', 'owner.voice');
  raise exception 'ASSERT FAILED: a coach asked about someone else''s capabilities';
exception when insufficient_privilege then raise notice 'ok: asking about others is the server''s';
end $$;
select t_assert((cleo_my_capabilities() ->> 'level') = 'automation', 'Ana''s level is automation');
select t_assert((select count(*) = 3 from cleo_entitlement_grants), 'Ana sees her own three grants');
reset role;

-- A revoked or expired grant is no grant.
reset role; select t_as(:owner); set role authenticated;
-- the owner finds the grant through the overview, as the app does
select cleo_entitlement_revoke((select (g ->> 'id')::uuid from jsonb_array_elements(cleo_capability_overview() -> 'grants') g where g ->> 'feature_key' = 'automation.auto_send'));
reset role;
update cleo_entitlement_grants set starts_at = now() - interval '40 days', expires_at = now() - interval '1 day' where user_id = :ana and feature_key = 'automation.follow_ups';
reset role; select t_as_service(); set role service_role;
select t_assert(not cleo_has_feature(:ana, 'automation.auto_send'), 'a revoked grant stops at once');
select t_assert(not cleo_has_feature(:ana, 'automation.follow_ups'), 'an expired grant stops at its date');
select t_assert(cleo_has_feature(:ana, 'automation.approval_queue'), 'the rest of her plan stays');
reset role;
do $$ begin
  update cleo_entitlement_grants set feature_key = 'owner.voice' where user_id = '00000000-0000-0000-0000-0000000000c1' and feature_key = 'automation.approval_queue';
  raise exception 'ASSERT FAILED: a grant was changed into an owner capability';
exception when insufficient_privilege then raise notice 'ok: a grant can''t be turned into the owner level';
end $$;

-- ════ 2. Settings: within your own level ═════════════════════════════════════
reset role; select t_as(:owner); set role authenticated;
select coach_automation_settings_set(false, '{"recovery_reply":"automatic","recovery_follow_up":"approval"}');
select t_assert((select modes ->> 'recovery_reply' = 'automatic' from coach_automation_settings where user_id = :owner), 'the owner turns on automatic replies');
do $$ begin
  perform coach_automation_settings_set(false, '{"recovery_reply":"yolo"}');
  raise exception 'ASSERT FAILED: an unknown mode was saved';
exception when invalid_parameter_value then raise notice 'ok: modes are checked';
end $$;
do $$ begin
  perform coach_automation_client_rule_set('00000000-0000-0000-0000-0000000c1e02', 'recovery_reply', 'off');
  raise exception 'ASSERT FAILED: the owner set a rule for another coach''s client';
exception when insufficient_privilege then raise notice 'ok: rules are for your own clients';
end $$;
select coach_automation_client_rule_set(:devin, 'recovery_reply', 'off');
reset role;

reset role; select t_as(:ana); set role authenticated;
do $$ begin
  perform coach_automation_settings_set(false, '{"recovery_reply":"automatic"}');
  raise exception 'ASSERT FAILED: a coach without auto-send turned it on';
exception when insufficient_privilege then raise notice 'ok: automatic needs its capability';
end $$;
do $$ begin
  perform coach_automation_settings_set(false, '{"recovery_follow_up":"approval"}');
  raise exception 'ASSERT FAILED: follow-ups without the capability';
exception when insufficient_privilege then raise notice 'ok: follow-ups need their capability';
end $$;
select coach_automation_settings_set(false, '{"recovery_reply":"approval"}');
do $$ begin
  insert into coach_automation_settings (user_id, modes) values ('00000000-0000-0000-0000-0000000000c1', '{"recovery_reply":"automatic"}');
  raise exception 'ASSERT FAILED: a coach wrote her settings directly';
exception when insufficient_privilege then raise notice 'ok: settings only through the checked function';
end $$;
select t_assert((select count(*) = 0 from coach_automation_settings where user_id = :owner), 'a coach can''t read the owner''s settings');
reset role;

reset role; select t_as(:mia_user); set role authenticated;
do $$ begin
  perform coach_automation_settings_set(false, '{}');
  raise exception 'ASSERT FAILED: a member saved automation settings';
exception when insufficient_privilege then raise notice 'ok: a member has no automation';
end $$;
reset role;

-- A mode a level no longer allows steps down (written straight in: an old row, a lapsed plan).
update coach_automation_settings set modes = '{"recovery_reply":"automatic"}' where user_id = :ana;
reset role; select t_as_service(); set role service_role;
select t_assert(coach_automation_mode_for(:ana, :nico, 'recovery_reply') = 'approval', 'automatic without auto-send runs as approval');
select t_assert(coach_automation_mode_for(:ana, :nico, 'recovery_follow_up') = 'off', 'follow-ups without the capability are off');
select t_assert(coach_automation_mode_for(:owner, :marc, 'recovery_reply') = 'automatic', 'the owner''s setting applies');
select t_assert(coach_automation_mode_for(:owner, :devin, 'recovery_reply') = 'off', 'a client''s own rule beats it');
select t_assert(coach_automation_mode_for(:fionna, :marc, 'recovery_reply') = 'off', 'nothing for someone without the capability');
reset role;

-- ════ 3. A pain report queues one reply ══════════════════════════════════════
reset role; select t_as_service(); set role service_role;
insert into pain_reports (client_id, feedback_id, source, region, side, score) values
  (:marc, '00000000-0000-0000-0000-00000000fb01', 'review', 'shoulder', 'L', 5),
  (:marc, '00000000-0000-0000-0000-00000000fb01', 'review', 'knee', 'R', 3);
select t_assert((select count(*) = 1 from coach_automation_items where client_id = :marc), 'two places in one review queue one reply');
select t_assert((select coach_user_id = :owner and status = 'queued' and due_at > now() and regions @> array['shoulder','knee'] from coach_automation_items where client_id = :marc), 'for Marc''s coach, after a quiet moment, covering both places');
update pain_reports set score = 6 where client_id = :marc and region = 'shoulder';
select t_assert((select count(*) = 1 from coach_automation_items where client_id = :marc), 'editing the review keeps it one reply');
insert into pain_reports (client_id, feedback_id, source, region) values (:devin, '00000000-0000-0000-0000-00000000fb02', 'review', 'knee');
select t_assert((select count(*) = 0 from coach_automation_items where client_id = :devin), 'a client the coach turned off gets nothing');
insert into pain_reports (client_id, feedback_id, source, region) values (:old, '00000000-0000-0000-0000-00000000fb03', 'review', 'knee');
select t_assert((select count(*) = 0 from coach_automation_items where client_id = :old), 'an archived client gets nothing');
insert into pain_reports (client_id, checkin_id, source, region) values (:marc, '00000000-0000-0000-0000-00000000cc01', 'checkin', 'knee');
select t_assert((select count(*) = 1 from coach_automation_items where client_id = :marc), 'a check-in''s pain stays in the check-in''s own reply');
insert into pain_reports (client_id, feedback_id, source, region) values (:nico, '00000000-0000-0000-0000-00000000fb04', 'review', 'elbow');
select t_assert((select count(*) = 1 and min(coach_user_id::text) = :ana from coach_automation_items where client_id = :nico), 'Ana''s plan queues her own client''s reply, for her');
reset role;

-- Pause: nothing new is queued.
reset role; select t_as(:owner); set role authenticated;
select coach_automation_settings_set(true, '{"recovery_reply":"automatic"}');
reset role;
reset role; select t_as_service(); set role service_role;
insert into pain_reports (client_id, feedback_id, source, region) values (:marc, '00000000-0000-0000-0000-00000000fb05', 'review', 'hip_groin');
select t_assert((select count(*) = 1 from coach_automation_items where client_id = :marc), 'paused queues nothing');
reset role;

-- ════ 4. Who reads the queue ═════════════════════════════════════════════════
reset role; select t_as(:owner); set role authenticated;
select t_assert((select count(*) = 1 from coach_automation_items), 'the owner reads his own clients'' items only');
do $$ begin
  update coach_automation_items set status = 'sent';
  raise exception 'ASSERT FAILED: an item changed from the app';
exception when insufficient_privilege then raise notice 'ok: only the server changes items';
end $$;
reset role;
reset role; select t_as(:ana); set role authenticated;
select t_assert((select count(*) = 1 and bool_and(client_id = :nico) from coach_automation_items), 'Ana reads hers, never the owner''s');
reset role;
reset role; select t_as(:fionna); set role authenticated;
select t_assert((select count(*) = 0 from coach_automation_items), 'a second admin reads none of the owner''s queue');
reset role;
reset role; select t_as(:mia_user); set role authenticated;
select t_assert((select count(*) = 0 from coach_automation_items) and (select count(*) = 0 from coach_automation_events), 'a member reads nothing');
reset role;

-- ════ 5. The worker claims each item once ════════════════════════════════════
update coach_automation_items set due_at = now() - interval '1 minute' where client_id = :marc;
reset role; select t_as_service(); set role service_role;
select t_assert((select count(*) = 1 from coach_automation_claim((select id from coach_automation_items where client_id = :marc))), 'claimed once');
select t_assert((select count(*) = 0 from coach_automation_claim((select id from coach_automation_items where client_id = :marc))), 'never twice while it''s being worked');
select t_assert((select status = 'working' and attempts = 1 from coach_automation_items where client_id = :marc), 'working, first try');
reset role;
reset role; select t_as(:ana); set role authenticated;
do $$ begin
  perform coach_automation_claim(null);
  raise exception 'ASSERT FAILED: a coach claimed work';
exception when insufficient_privilege then raise notice 'ok: claiming is the worker''s';
end $$;
reset role;

-- ════ 6. The record is never rewritten ═══════════════════════════════════════
do $$ begin
  update coach_automation_events set kind = 'sent';
  raise exception 'ASSERT FAILED: the record was changed';
exception when insufficient_privilege then raise notice 'ok: the record is append-only';
end $$;
do $$ begin
  delete from coach_automation_events;
  raise exception 'ASSERT FAILED: the record was deleted';
exception when insufficient_privilege then raise notice 'ok: and never deleted';
end $$;

select 'recovery-automation: all assertions passed';
