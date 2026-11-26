-- Specialists (20270603090100_team_specialists.sql), run as each kind of login.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- ids
\set owner     '''00000000-0000-0000-0000-0000000000a1'''
\set owner_ath '''00000000-0000-0000-0000-0000000000a2'''
\set admin2    '''00000000-0000-0000-0000-0000000000a3'''
\set coach     '''00000000-0000-0000-0000-0000000000c1'''
\set marc      '''00000000-0000-0000-0000-0000000000d1'''
\set member    '''00000000-0000-0000-0000-0000000000e1'''
\set jesse     '''00000000-0000-0000-0000-0000000000b1'''
\set other_sp  '''00000000-0000-0000-0000-0000000000b2'''
\set c_owner   '''00000000-0000-0000-0000-0000000c1e00'''
\set c_marc    '''00000000-0000-0000-0000-0000000c1e01'''
\set c_nico    '''00000000-0000-0000-0000-0000000c1e02'''

-- ── The seeded invite ──────────────────────────────────────────────────────
select t_assert((select count(*) = 1 from staff_invites where first_name = 'Jesse' and role::text = 'specialist'
                 and status = 'draft' and email is null and preset = 'game_day_coach' and title = 'Game Day Coach'),
                'Jesse waits as a Game Day Coach draft with no email');
select t_assert((select access = jsonb_build_array(jsonb_build_object('client_id', :c_owner::uuid, 'footage', true, 'training', true,
                                                                      'performance', true, 'granted_by', :owner::uuid))
                   from staff_invites where first_name = 'Jesse'),
                'Jesse''s draft gives the owner''s own athlete account, every category, added by the owner');

-- Who added an athlete is the database's to say when someone writes with their own login
reset role; select t_as(:admin2);
update staff_invites
   set access = jsonb_build_array(
         jsonb_build_object('client_id', :c_owner::uuid, 'footage', true, 'training', true, 'performance', true, 'granted_by', :owner::uuid),
         jsonb_build_object('client_id', :c_marc::uuid, 'footage', true, 'training', false, 'performance', false, 'granted_by', :owner::uuid)),
       created_by = :admin2
 where first_name = 'Jesse';
select t_assert((select (access -> 0 ->> 'granted_by')::uuid = :owner::uuid and (access -> 1 ->> 'granted_by')::uuid = :admin2::uuid
                   from staff_invites where first_name = 'Jesse'),
                'an athlete another admin adds is theirs, even when they say it was the owner''s');
select t_assert((select created_by = :owner::uuid from staff_invites where first_name = 'Jesse'), 'who made an invite never changes');
update staff_invites
   set access = jsonb_build_array(
         jsonb_build_object('client_id', :c_owner::uuid, 'footage', true, 'training', true, 'performance', true, 'granted_by', :owner::uuid),
         jsonb_build_object('client_id', :c_marc::uuid, 'footage', true, 'training', true, 'performance', false, 'granted_by', :owner::uuid))
 where first_name = 'Jesse';
select t_assert((select (access -> 1 ->> 'granted_by')::uuid = :admin2::uuid from staff_invites where first_name = 'Jesse'),
                'widening an athlete makes it the editor''s');
reset role; select t_as_service();
update staff_invites
   set access = jsonb_build_array(jsonb_build_object('client_id', :c_owner::uuid, 'footage', true, 'training', true,
                                                     'performance', true, 'granted_by', :owner::uuid))
 where first_name = 'Jesse';

-- ── Codes for a texted or copied link: counted in the database ─────────────
insert into staff_invites (id, email, role, status, setup_token_hash)
values ('00000000-0000-0000-0000-00000000c0de', 'code@example.test', 'finance', 'pending', 'hash-1');
select t_assert(staff_invite_code_issue('00000000-0000-0000-0000-00000000c0de', 'code-hash', 15) = 'sent', 'a code goes out');
select t_assert(staff_invite_code_issue('00000000-0000-0000-0000-00000000c0de', 'code-hash-2', 15) = 'wait', 'a second right away waits');
select t_assert((select code_hash = 'code-hash' from staff_invites where id = '00000000-0000-0000-0000-00000000c0de'), 'and doesn''t replace the first');
select t_assert(staff_invite_code_try('00000000-0000-0000-0000-00000000c0de') = 'code-hash', 'try 1 is counted and checked');
select staff_invite_code_try('00000000-0000-0000-0000-00000000c0de') from generate_series(2, 5);
select t_assert(staff_invite_code_try('00000000-0000-0000-0000-00000000c0de') is null, 'a sixth try gets nothing to check against');
update staff_invites set code_sent_at = now() - interval '1 minute', codes_sent = 4 where id = '00000000-0000-0000-0000-00000000c0de';
select t_assert(staff_invite_code_issue('00000000-0000-0000-0000-00000000c0de', 'code-hash-5', 15) = 'sent', 'a fifth code goes out');
update staff_invites set code_sent_at = now() - interval '1 minute' where id = '00000000-0000-0000-0000-00000000c0de';
select t_assert(staff_invite_code_issue('00000000-0000-0000-0000-00000000c0de', 'code-hash-6', 15) = 'limit', 'a link gets 5 codes');
update staff_invites set setup_token_hash = 'hash-2' where id = '00000000-0000-0000-0000-00000000c0de';
select t_assert((select codes_sent = 0 and code_hash is null from staff_invites where id = '00000000-0000-0000-0000-00000000c0de'),
                'a new link starts its codes over');
reset role; select t_as(:admin2); set role authenticated;
do $$ begin
  perform staff_invite_code_try('00000000-0000-0000-0000-00000000c0de');
  raise exception 'ASSERT FAILED: a login checked a code directly';
exception when insufficient_privilege then raise notice 'ok: only the server checks codes';
end $$;
reset role; select t_as_service();

-- Invites keep their shape
do $$ begin
  insert into staff_invites (role, status) values ('finance', 'pending');
  raise exception 'ASSERT FAILED: a pending invite with no email was accepted';
exception when check_violation then raise notice 'ok: a pending invite needs an email';
end $$;
do $$ begin
  insert into staff_invites (role, status, email) values ('specialist', 'pending', 'x@example.test');
  raise exception 'ASSERT FAILED: a specialist invite with no preset was accepted';
exception when check_violation then raise notice 'ok: a specialist invite needs a preset and a title';
end $$;
do $$ begin
  insert into staff_invites (role, status, email) values ('finance', 'sent', 'x@example.test');
  raise exception 'ASSERT FAILED: an unknown status was accepted';
exception when check_violation then raise notice 'ok: invite statuses are draft, pending, redeemed, revoked';
end $$;

-- ── Jesse redeems: a specialist login and an org membership ────────────────
insert into auth.users values (:jesse, 'jesse@example.test'), (:other_sp, 'sam@example.test');
insert into user_roles (user_id, role) values (:jesse, 'specialist'), (:other_sp, 'specialist');
select t_assert((select role = 'specialist' and status = 'active' from organization_members where user_id = :jesse),
                'a specialist login is a specialist member of JF Effect');
insert into team_specialists (user_id, preset, title, display_name, invited_by)
values (:jesse, 'game_day_coach', 'Game Day Coach', 'Jesse', :owner),
       (:other_sp, 'performance_specialist', 'Performance Specialist', 'Sam', :owner);
insert into specialist_access (specialist_user_id, client_id, granted_by)
values (:jesse, :c_owner, :owner);
reset role; select t_as(:jesse); set role authenticated;
select t_assert(not specialist_can_view(:c_owner, 'footage'), 'nothing until his profile is done and he agrees to keep it private');
reset role; select t_as_service();
update team_specialists
   set phone = '+12045550123', time_zone = 'America/Winnipeg', headshot_path = user_id::text || '/h.jpg',
       confidentiality_text = 'I''ll keep it private', confidentiality_at = now()
 where user_id in (:jesse, :other_sp);
select t_assert((select athlete_ok_by = 'self' and athlete_ok_at is not null from specialist_access where specialist_user_id = :jesse and client_id = :c_owner),
                'the owner sharing their own athlete account is agreed at once');
insert into specialist_access (specialist_user_id, client_id, granted_by, training, performance)
values (:jesse, :c_marc, :owner, false, false);
select t_assert((select athlete_ok_at is null from specialist_access where specialist_user_id = :jesse and client_id = :c_marc),
                'access to another athlete waits for that athlete');
-- only the owner sharing their own athlete account is that athlete's yes
insert into specialist_access (specialist_user_id, client_id, granted_by)
values (:other_sp, :c_owner, :admin2);
select t_assert((select athlete_ok_at is null from specialist_access where specialist_user_id = :other_sp and client_id = :c_owner),
                'another admin giving the owner''s athlete account waits for the owner');
-- an admin who links their own login to an athlete's doesn't get to answer for them
insert into community_profiles (user_id, same_person_as) values (:admin2, :marc);
select id as marc_access from specialist_access where specialist_user_id = :jesse and client_id = :c_marc \gset
reset role; select t_as(:admin2); set role authenticated;
select t_assert((select count(*) = 0 from my_team_access()), 'an admin linked to someone''s login doesn''t see their requests');
select t_assert(specialist_access_respond(:'marc_access', true, true, false, false) = 'not_found',
                'nor agree for them');
reset role; select t_as_service();
select t_assert((select athlete_ok_at is null from specialist_access where id = :'marc_access'), 'Marc''s access still waits for Marc');
delete from community_profiles where user_id = :admin2;
delete from specialist_access where specialist_user_id = :other_sp and client_id = :c_owner;
select t_assert((select count(*) >= 3 from organization_audit_log where target_id = :jesse::uuid and action like 'specialist.%'),
                'the access record keeps each grant and the new specialist');

-- ── What Jesse sees ────────────────────────────────────────────────────────
reset role; select t_as(:jesse); set role authenticated;
select t_assert(specialist_can_view(:c_owner, 'footage'), 'Jesse sees the owner''s footage');
select t_assert(specialist_can_view(:c_owner, 'training'), 'Jesse sees the owner''s training');
select t_assert(specialist_can_view(:c_owner, 'performance'), 'Jesse sees the owner''s performance');
select t_assert(not specialist_can_view(:c_owner, 'nutrition'), 'no other category exists for a specialist');
select t_assert(not specialist_can_view(:c_marc, 'footage'), 'not Marc before Marc agrees');
select t_assert(not specialist_can_view(:c_nico, 'footage'), 'not an athlete nobody gave him');
select t_assert((select count(*) = 1 from specialist_my_athletes()), 'his athlete list is the one agreed athlete');
select t_assert((select count(*) = 2 from specialist_access), 'he reads his own two access rows');
select t_assert((select count(*) = 0 from specialist_access where specialist_user_id <> :jesse), 'never another specialist''s');
select t_assert((select count(*) = 1 from team_specialists), 'he reads only his own record');
select t_assert((select count(*) = 0 from organization_audit_log), 'not the access record');
-- the definer helpers that aren't his to call
do $$ begin
  perform _team_same_person('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');
  raise exception 'ASSERT FAILED: a specialist ran an internal helper';
exception when insufficient_privilege then raise notice 'ok: internal helpers are the server''s';
end $$;

-- two-step: while his session isn't confirmed his role does nothing
reset role; select t_as_service();
insert into mfa_pending values (:jesse);
reset role; select t_as(:jesse); set role authenticated;
select t_assert(not specialist_can_view(:c_owner, 'footage'), 'an unconfirmed two-step session sees nothing');
reset role; select t_as_service();
delete from mfa_pending;

-- ── Nobody else is a specialist ────────────────────────────────────────────
reset role; select t_as(:coach); set role authenticated;
select t_assert(not specialist_can_view(:c_owner, 'footage'), 'a coach is not a specialist');
select t_assert((select count(*) = 0 from specialist_access), 'a coach reads no specialist access');
reset role; select t_as(:owner); set role authenticated;
select t_assert(not specialist_can_view(:c_owner, 'footage'), 'the owner is not a specialist either');
select t_assert((select count(*) = 2 from specialist_access), 'the owner reads every specialist access row');
select t_assert((select count(*) = 2 from team_specialists), 'the owner reads every specialist');
reset role; select t_as(:member); set role authenticated;
select t_assert(not specialist_can_view(:c_owner, 'footage'), 'a member is not a specialist');
select t_assert((select count(*) = 0 from team_specialists), 'a member reads no specialist');
reset role; select t_as(:other_sp); set role authenticated;
select t_assert(not specialist_can_view(:c_owner, 'footage'), 'another specialist sees only their own athletes');

-- ── The athlete's side ─────────────────────────────────────────────────────
reset role; select t_as(:marc); set role authenticated;
select t_assert((select count(*) = 1 and bool_and(not agreed) from my_team_access()), 'Marc sees Jesse asking, not yet agreed');
select t_assert((select specialist_access_respond(access_id, true, not footage, training, performance) = 'changed' from my_team_access()),
                'a yes to something other than what he was shown agrees to nothing');
select t_assert((select bool_and(not agreed) from my_team_access()), 'still waiting');
select t_assert((select specialist_access_respond(access_id, true, footage, training, performance) = 'allowed' from my_team_access()),
                'Marc agrees to exactly what he was shown');
reset role; select t_as(:jesse); set role authenticated;
select t_assert(specialist_can_view(:c_marc, 'footage'), 'then Jesse sees Marc''s footage');
select t_assert(not specialist_can_view(:c_marc, 'training'), 'but only the categories the owner turned on');
reset role; select t_as(:member); set role authenticated;
select t_assert((select count(*) = 0 from specialist_access), 'a member reads no access row');
reset role; select t_as_service();
-- a member answering someone else's access by id
create temp table t_ids as select id from specialist_access where client_id = '00000000-0000-0000-0000-0000000c1e01';
grant select on t_ids to authenticated;
reset role; select t_as(:member); set role authenticated;
select t_assert((select specialist_access_respond(id, false) from t_ids) = 'not_found', 'nobody answers for someone else''s training');
reset role; select t_as(:marc); set role authenticated;
select t_assert((select specialist_access_respond(id, false) from t_ids) = 'stopped', 'Marc stops sharing');
reset role; select t_as(:jesse); set role authenticated;
select t_assert(not specialist_can_view(:c_marc, 'footage'), 'and Jesse loses Marc at once');
reset role; select t_as(:owner); set role authenticated;
select t_assert((select count(*) = 1 from my_team_access()), 'the owner''s linked staff login answers for their athlete account');

-- ── Suspend, archive, remove ───────────────────────────────────────────────
reset role; select t_as_service();
update team_specialists set status = 'suspended' where user_id = :jesse;
reset role; select t_as(:jesse); set role authenticated;
select t_assert(not specialist_can_view(:c_owner, 'footage'), 'a suspended specialist sees nothing');
reset role; select t_as_service();
update team_specialists set status = 'active' where user_id = :jesse;
update clients set archived = true where id = :c_owner;
reset role; select t_as(:jesse); set role authenticated;
select t_assert(not specialist_can_view(:c_owner, 'footage'), 'an archived athlete is out of reach');
reset role; select t_as_service();
update clients set archived = false where id = :c_owner;
update specialist_access set footage = false where specialist_user_id = :jesse and client_id = :c_owner;
reset role; select t_as(:jesse); set role authenticated;
select t_assert(not specialist_can_view(:c_owner, 'footage') and specialist_can_view(:c_owner, 'training'),
                'a category turned off is off, the rest stay');
reset role; select t_as_service();
update specialist_access set footage = true where specialist_user_id = :jesse and client_id = :c_owner;
select t_assert((select athlete_ok_by = 'self' from specialist_access where specialist_user_id = :jesse and client_id = :c_owner),
                'the owner widening their own athlete account''s access is still their own yes');
-- Marc agrees to footage, then the owner turns training on: Marc has to agree again
insert into specialist_access (specialist_user_id, client_id, granted_by, training, performance)
values (:other_sp, :c_marc, :owner, false, false);
update specialist_access set athlete_ok_at = now(), athlete_ok_by = 'athlete' where specialist_user_id = :other_sp and client_id = :c_marc;
update specialist_access set footage = false where specialist_user_id = :other_sp and client_id = :c_marc;
select t_assert((select athlete_ok_at is not null from specialist_access where specialist_user_id = :other_sp and client_id = :c_marc),
                'narrowing access keeps the athlete''s yes');
update specialist_access set training = true where specialist_user_id = :other_sp and client_id = :c_marc;
select t_assert((select athlete_ok_at is null from specialist_access where specialist_user_id = :other_sp and client_id = :c_marc),
                'widening access asks the athlete again');

-- ── Notes: private to their author ─────────────────────────────────────────
insert into specialist_notes (client_id, author_user_id, target_kind, target_id, body)
values (:c_owner, :jesse, 'set_video', '00000000-0000-0000-0000-0000000f0001', 'Bar drifted forward on rep 3.');
reset role; select t_as(:jesse); set role authenticated;
select t_assert((select count(*) = 1 from specialist_notes), 'Jesse reads his own note');
reset role; select t_as(:other_sp); set role authenticated;
select t_assert((select count(*) = 0 from specialist_notes), 'another specialist doesn''t');
reset role; select t_as(:owner); set role authenticated;
select t_assert((select count(*) = 0 from specialist_notes), 'the owner doesn''t read a private note');
select t_assert((select count(*) = 0 from my_shared_team_notes()), 'nor does the athlete');
reset role; select t_as(:coach); set role authenticated;
select t_assert((select count(*) = 0 from specialist_notes), 'nor any coach');
reset role; select t_as_service();
update specialist_notes set visibility = 'shared' where author_user_id = :jesse;
select t_assert((select shared_at is not null from specialist_notes where author_user_id = :jesse), 'sharing stamps when');
reset role; select t_as(:owner); set role authenticated;
select t_assert((select count(*) = 1 and bool_and(author_name = 'Jesse') from my_shared_team_notes('set_video', '00000000-0000-0000-0000-0000000f0001')),
                'a shared note reaches the athlete with who wrote it');
select t_assert((select count(*) = 0 from specialist_notes), 'still never through the table itself');
reset role; select t_as(:marc); set role authenticated;
select t_assert((select count(*) = 0 from my_shared_team_notes()), 'never another athlete');
reset role; select t_as_service();
do $$ begin
  update specialist_notes set target_id = gen_random_uuid() where author_user_id = '00000000-0000-0000-0000-0000000000b1';
  raise exception 'ASSERT FAILED: a note moved to another target';
exception when insufficient_privilege then raise notice 'ok: a note stays on what it was written about';
end $$;

-- ── Removing the role ends the membership and every view ───────────────────
delete from user_roles where user_id = :jesse and role = 'specialist';
select t_assert((select status = 'revoked' from organization_members where user_id = :jesse), 'removing the role revokes the membership');
reset role; select t_as(:jesse); set role authenticated;
select t_assert(not specialist_can_view(:c_owner, 'footage'), 'a removed specialist sees nothing');
select t_assert((select count(*) = 0 from specialist_my_athletes()), 'and has no athletes');

-- Writes are never a signed-in person's
reset role; select t_as(:jesse); set role authenticated;
do $$ begin
  insert into specialist_notes (client_id, author_user_id, target_kind, target_id, body)
  values ('00000000-0000-0000-0000-0000000c1e00', '00000000-0000-0000-0000-0000000000b1', 'session', gen_random_uuid(), 'x');
  raise exception 'ASSERT FAILED: a login wrote a note directly';
exception when insufficient_privilege then raise notice 'ok: notes are written by the server only';
end $$;
do $$ begin
  update specialist_access set footage = true;
  raise exception 'ASSERT FAILED: a login changed access directly';
exception when insufficient_privilege then raise notice 'ok: access is written by the server only';
end $$;

reset role; select t_as_service();
\echo 'team specialists: all assertions passed'
