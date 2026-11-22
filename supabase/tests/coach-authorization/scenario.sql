\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- Ids from schema.sql
\set owner  '''00000000-0000-0000-0000-0000000000a1'''
\set ana    '''00000000-0000-0000-0000-0000000000c1'''
\set ben    '''00000000-0000-0000-0000-0000000000c2'''
\set fin    '''00000000-0000-0000-0000-0000000000f1'''
\set mia_user '''00000000-0000-0000-0000-0000000000e1'''
\set ana_coach '''00000000-0000-0000-0000-00000000c0a1'''
\set marc   '''00000000-0000-0000-0000-0000000c1e01'''
\set nico   '''00000000-0000-0000-0000-0000000c1e02'''
\set mia    '''00000000-0000-0000-0000-0000000c1e03'''
\set p_marc '''00000000-0000-0000-0000-00000000b001'''
\set p_nico '''00000000-0000-0000-0000-00000000b002'''

-- ════ 1. Cleo's cards run as the requester ═══════════════════════════════════

-- Who a request may reach, decided about the requester (never the caller's session).
reset role; select t_as_service(); set role service_role;
select t_assert(cleo_action_target_allowed(:ana, :marc), 'a coach''s request reaches their own client');
select t_assert(not cleo_action_target_allowed(:ana, :nico), 'a coach''s request never reaches another coach''s client');
select t_assert(cleo_action_target_allowed(:owner, :nico), 'the admin''s reaches anyone');
select t_assert(not cleo_action_target_allowed(:fin, :marc), 'the finance login reaches no client''s coaching');
select t_assert(not cleo_action_target_allowed(:mia_user, :mia), 'a client reaches nothing, not even their own record');
select t_assert(not cleo_action_target_allowed(null, :marc), 'nobody is nobody');

-- Marking check-ins reviewed as the coach who asked, by the server only.
select t_assert((select cleo_mark_client_reviews_reviewed_as(:ana, :marc) = 3), 'the server marks Marc''s waiting items reviewed for Ana');
select t_assert((select reviewed_by = :ana from messenger_checkins where client_id = :marc), 'reviewed by Ana, the coach who asked, never the approver');
select t_assert((select reviewed_by = :ana from nf_submissions where client_id = :marc), 'the form too');
do $$ begin
  perform cleo_mark_client_reviews_reviewed_as('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000c1e02');
  raise exception 'ASSERT FAILED: Ana reviewed Nico''s check-ins';
exception when insufficient_privilege then raise notice 'ok: not for another coach''s client';
end $$;
select t_assert((select reviewed_at is null from messenger_checkins where client_id = :nico), 'Nico''s check-in untouched');
reset role;

-- Nobody signed in can call either one.
reset role; select t_as(:ana); set role authenticated;
do $$ begin
  perform cleo_action_target_allowed('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000c1e02');
  raise exception 'ASSERT FAILED: a signed-in coach called the server''s check';
exception when insufficient_privilege then raise notice 'ok: the target check is the server''s';
end $$;
do $$ begin
  perform cleo_mark_client_reviews_reviewed_as('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000c1e01');
  raise exception 'ASSERT FAILED: a signed-in coach called the server''s review';
exception when insufficient_privilege then raise notice 'ok: reviewing as someone is the server''s';
end $$;
reset role;

-- A card runs as its requester: the database refuses any other.
insert into cleo_actions (id, requested_by, kind, params, summary, permission, status)
  values ('00000000-0000-0000-0000-00000000ca01', :ana, 'send_message', '{}', 'x', 'client', 'awaiting_approval');
update cleo_actions set status = 'running', decided_by = :owner, decided_at = now(), executed_as = :ana where id = '00000000-0000-0000-0000-00000000ca01';
select t_assert((select executed_as = :ana and decided_by = :owner from cleo_actions where id = '00000000-0000-0000-0000-00000000ca01'), 'approved by the owner, run as Ana');
do $$ begin
  update cleo_actions set executed_as = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-00000000ca01';
  raise exception 'ASSERT FAILED: a card ran as its approver';
exception when check_violation then raise notice 'ok: a card never runs as anyone but its requester';
end $$;

-- Who reads cards.
insert into cleo_actions (requested_by, kind, summary, permission) values (:ben, 'add_client_note', 'y', 'client');
reset role; select t_as(:ana); set role authenticated;
select t_assert((select count(*) = 1 from cleo_actions), 'a coach reads only their own cards');
reset role; select t_as(:owner); set role authenticated;
select t_assert((select count(*) = 2 from cleo_actions), 'the owner reads every card (to approve them)');
reset role;

-- ════ 2. Money: read-only for a coach, their own clients only ══════════════

reset role; select t_as(:ana); set role authenticated;
select t_assert((select count(*) = 2 from purchase_records), 'Ana reads her clients'' sales (Marc, Mia)');
select t_assert(not exists (select 1 from purchase_records where client_id = :nico), 'never Nico''s');
do $$ begin
  insert into purchase_records (client_id, offer_name, payment_status, amount_paid_cents)
  values ('00000000-0000-0000-0000-0000000c1e01', 'made up', 'Paid', 999999);
  raise exception 'ASSERT FAILED: a coach wrote a sale';
exception when insufficient_privilege then raise notice 'ok: a coach can''t add a sale, even for their own client';
end $$;
update purchase_records set payment_status = 'Paid', amount_paid_cents = 999999 where id = :p_marc;
delete from purchase_records where id = :p_marc;
reset role;
select t_assert((select payment_status = 'Unpaid' and amount_paid_cents = 0 from purchase_records where id = :p_marc), 'a coach''s update to their client''s sale changed nothing');
select t_assert(exists (select 1 from purchase_records where id = :p_marc), 'and their delete removed nothing');

reset role; select t_as(:ana); set role authenticated;
select t_assert((select count(*) = 1 from member_payment_ledger), 'Ana reads the member ledger of Mia, her client');
do $$ begin
  insert into member_payment_ledger (member_id, amount_cents, status) values ('00000000-0000-0000-0000-0000000aa001', 1, 'comped');
  raise exception 'ASSERT FAILED: a coach recorded a membership payment';
exception when insufficient_privilege then raise notice 'ok: a coach can''t record membership money';
end $$;
select t_assert((select count(*) = 1 from coaching_package_enrollments), 'Ana reads Marc''s package');
do $$ begin
  insert into coaching_package_enrollments (client_id, package_id, contracted_price_cents)
  values ('00000000-0000-0000-0000-0000000c1e01', '00000000-0000-0000-0000-0000000ab001', 1);
  raise exception 'ASSERT FAILED: a coach put a client on a package';
exception when insufficient_privilege then raise notice 'ok: a coach can''t put a client on a package';
end $$;
update coaching_package_enrollments set contracted_price_cents = 1 where client_id = :marc;
select t_assert((select count(*) = 1 from payment_share_links), 'Ana sees only her clients'' payment links');
select t_assert((select token = 'tok-marc' from payment_share_links), 'Marc''s, not Nico''s');
reset role;
select t_assert((select contracted_price_cents = 13000 from coaching_package_enrollments where client_id = :marc), 'a coach''s change to a contracted price changed nothing');

reset role; select t_as(:ben); set role authenticated;
select t_assert((select count(*) = 1 from payment_share_links), 'Ben sees only Nico''s payment link');
select t_assert((select count(*) = 0 from member_payment_ledger), 'Ben reads no ledger of someone else''s member');

-- The admin, unchanged.
reset role; select t_as(:owner); set role authenticated;
select t_assert((select count(*) = 3 from purchase_records), 'the admin reads every sale');
insert into purchase_records (client_id, offer_name, payment_status) values (:nico, 'Renewal', 'Unpaid');
update purchase_records set offer_name = 'Renewal 2' where offer_name = 'Renewal';
select t_assert((select count(*) = 1 from purchase_records where offer_name = 'Renewal 2'), 'the admin still adds and changes sales');
insert into member_payment_ledger (member_id, amount_cents, status) values ('00000000-0000-0000-0000-0000000aa001', 100, 'manual');
insert into coaching_package_enrollments (client_id, package_id) values (:mia, '00000000-0000-0000-0000-0000000ab001');
update coaching_package_enrollments set contracted_price_cents = 12000 where client_id = :mia;
select t_assert((select contracted_price_cents = 12000 from coaching_package_enrollments where client_id = :mia), 'the admin still sets packages');
select t_assert((select count(*) = 2 from payment_share_links), 'the admin sees every payment link');

-- A client still reads their own sale.
reset role; select t_as(:mia_user); set role authenticated;
select t_assert((select count(*) = 1 from purchase_records), 'a client reads their own sale');
select t_assert((select count(*) = 0 from payment_share_links), 'a client sees no payment-link rows');
reset role;

-- ════ 3. Client data: a coach's own clients only ════════════════════════════

reset role; select t_as(:ana); set role authenticated;
select t_assert((select count(*) = 1 and min(meal_plan_text) = 'Marc plan' from nutrition_ai_plans), 'Ana reads only her client''s AI meal plan');
select t_assert((select count(*) = 2 from support_alerts), 'Ana sees her client''s alert and one aimed at her');
select t_assert(not exists (select 1 from support_alerts where client_id is null and coach_id is null), 'never a system alert (no client)');
update support_alerts set status = 'resolved' where client_id = :nico;
select t_assert((select count(*) = 1 from pl_completion_link_review), 'Ana reads only her client''s link reviews');
select t_assert((select count(*) = 4 from warmup_assignments), 'Ana sees library warm-ups and her client''s (client, block, day)');
do $$ begin
  insert into warmup_assignments (protocol_id, scope, pl_block_id) values (gen_random_uuid(), 'pl_block', '00000000-0000-0000-0000-0000000bb002');
  raise exception 'ASSERT FAILED: a coach set a warm-up on another coach''s client''s block';
exception when insufficient_privilege then raise notice 'ok: no warm-ups on another coach''s client';
end $$;
insert into warmup_assignments (protocol_id, scope, pl_day_id) values (gen_random_uuid(), 'pl_day', '00000000-0000-0000-0000-0000000dd001');
select t_assert(true, 'Ana still sets a warm-up on her own client''s day');
delete from warmup_assignments where client_id = :nico;
select t_assert((select count(*) = 1 from event_assignments), 'Ana reads only her client''s event assignments');
do $$ begin
  insert into event_assignments (event_id, client_id) values (gen_random_uuid(), '00000000-0000-0000-0000-0000000c1e02');
  raise exception 'ASSERT FAILED: a coach assigned an event to another coach''s client';
exception when insufficient_privilege then raise notice 'ok: no event assignments for another coach''s client';
end $$;
select t_assert((select count(*) = 1 and min(body) = 'From Ana' from mass_message_log), 'Ana reads only her own broadcasts');
select t_assert((select count(*) = 1 from submission_reviews), 'Ana reads only her client''s submission reviews, no unmatched ones');
update submission_reviews set review_status = 'reviewed' where id = '00000000-0000-0000-0000-0000000fe002';
select t_assert((select count(*) = 1 from scheduled_submission_responses), 'review children: scheduled responses');
select t_assert((select count(*) = 1 from submission_ai_generations), 'review children: AI generations');
select t_assert((select count(*) = 1 from submission_audit_events), 'review children: audit events');
select t_assert((select count(*) = 1 from submission_delivery_attempts), 'review children: delivery attempts');
do $$ begin
  insert into submission_audit_events (review_id, note) values ('00000000-0000-0000-0000-0000000fe003', 'peek');
  raise exception 'ASSERT FAILED: a coach logged on an unmatched submission';
exception when insufficient_privilege then raise notice 'ok: no audit events on submissions that aren''t her client''s';
end $$;
insert into submission_audit_events (review_id, note) values ('00000000-0000-0000-0000-0000000fe001', 'reviewed');
select t_assert((select count(*) = 1 and min(payload) = 'marc' from fillout_submissions), 'Ana reads only her client''s Fillout entries, never a website lead');
update fillout_submissions set payload = 'edited' where client_id is null;
reset role;
select t_assert((select status = 'open' from support_alerts where client_id = :nico), 'Ana''s update to Nico''s alert changed nothing');
select t_assert((select count(*) = 1 from warmup_assignments where client_id = :nico), 'and her delete of Nico''s warm-up removed nothing');
select t_assert((select review_status = 'pending' from submission_reviews where id = '00000000-0000-0000-0000-0000000fe002'), 'and Nico''s review is untouched');
select t_assert((select payload = 'website lead' from fillout_submissions where client_id is null), 'and the website lead is untouched');

reset role; select t_as(:ben); set role authenticated;
select t_assert((select count(*) = 1 and min(meal_plan_text) = 'Nico plan' from nutrition_ai_plans), 'Ben reads only Nico''s plan');
select t_assert((select count(*) = 1 from support_alerts), 'Ben sees only Nico''s alert');
update support_alerts set status = 'in_progress' where client_id = :nico;
select t_assert((select count(*) = 0 from mass_message_log), 'Ben sees no one else''s broadcasts');

-- A suspended coach (role taken away, record not Active) sees none of it.
reset role;
update coaches set status = 'Suspended' where user_id = :ben;
delete from user_roles where user_id = :ben and role = 'coach';
select t_as(:ben); set role authenticated;
select t_assert((select count(*) = 0 from nutrition_ai_plans), 'a suspended coach reads no plans');
select t_assert((select count(*) = 0 from purchase_records), 'nor sales');
select t_assert((select count(*) = 0 from support_alerts), 'nor alerts');
reset role; select t_as_service(); set role service_role;
select t_assert(not cleo_action_target_allowed(:ben, :nico), 'and a request they made before is refused when it runs');
reset role;
select t_assert((select status = 'in_progress' from support_alerts where client_id = :nico), 'Ben''s own client''s alert changed while he coached');

-- The admin, unchanged.
reset role; select t_as(:owner); set role authenticated;
select t_assert((select count(*) = 2 from nutrition_ai_plans), 'the admin reads every plan');
select t_assert((select count(*) = 4 from support_alerts), 'every alert');
select t_assert((select count(*) = 3 from submission_reviews), 'every review');
select t_assert((select count(*) = 3 from scheduled_submission_responses), 'their children');
select t_assert((select count(*) = 3 from fillout_submissions), 'every Fillout entry');
select t_assert((select count(*) >= 7 from warmup_assignments), 'every warm-up');
select t_assert((select count(*) = 2 from event_assignments), 'every event assignment');
select t_assert((select count(*) = 2 from mass_message_log), 'every broadcast');
reset role;

-- A client still sees their own alerts.
insert into support_alerts (client_id, error_message) values (:mia, 'Mia''s workout');
reset role; select t_as(:mia_user); set role authenticated;
select t_assert((select count(*) = 1 from support_alerts), 'a client reads their own alert');
select t_assert((select count(*) = 0 from nutrition_ai_plans), 'a client reads no AI plan rows');
reset role;

\echo 'coach-authorization: all assertions passed'
