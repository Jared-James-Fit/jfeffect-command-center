\set ON_ERROR_STOP 1
set client_min_messages = notice;

\set owner '''00000000-0000-0000-0000-00000000000a'''
\set fin '''00000000-0000-0000-0000-00000000000f'''
\set coach '''00000000-0000-0000-0000-00000000000c'''
\set client '''00000000-0000-0000-0000-00000000000b'''
\set a1 '''a1000000-0000-0000-0000-000000000001'''
\set a2 '''a2000000-0000-0000-0000-000000000002'''
\set f1 '''f1000000-0000-0000-0000-000000000001'''
\set f2 '''f2000000-0000-0000-0000-000000000002'''
\set c1 '''c1000000-0000-0000-0000-000000000001'''
\set k1 '''b1000000-0000-0000-0000-000000000001'''
\set h1 '''1111111111111111111111111111111111111111111111111111111111111111'''
\set h2 '''2222222222222222222222222222222222222222222222222222222222222222'''

-- ════ 1. Nothing changes for anyone until they set something up ═════════════
reset role; select t_token(:owner, :a1, 'aal1'); set role authenticated;
select t_assert(not has_role(:owner, 'admin'), 'the owner with an authenticator app gets no admin rights on a password-only session');
reset role; select t_token(:owner, :a1, 'aal2'); set role authenticated;
select t_assert(has_role(:owner, 'admin') and is_business_owner(:owner), 'the authenticator app''s aal2 still works exactly as before');
reset role; select t_token(:fin, :f1, 'aal1'); set role authenticated;
select t_assert(has_role(:fin, 'finance') and has_permission(:fin, 'finance.read'), 'a login with nothing set up is exactly as before');
reset role; select t_token(:client, :k1, 'aal1'); set role authenticated;
select t_assert(has_role(:client, 'client'), 'a client never has a second step');
reset role; select t_token(:coach, :c1, 'aal1'); set role authenticated;
select t_assert(has_role(:coach, 'coach'), 'a coach with nothing set up keeps their rights (the app asks them to set it up)');
select t_assert(jwt_session_id() = :c1, 'the session id is read from the token');
reset role; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","session_id":"not-a-uuid"}', false); set role authenticated;
select t_assert(jwt_session_id() is null, 'a token without a usable session id reads as none, never an error');

-- ════ 2. The server sees who must confirm ═══════════════════════════════════
reset role; select t_service(); set role service_role;
select t_assert((select array_agg(x order by x) from mfa_enforced_logins() x) = array[:owner::uuid], 'only the login with an authenticator app is enforced');
select t_assert(two_step_login_has(:owner) and not two_step_login_has(:fin), 'two_step_login_has reads authenticator apps');

-- Fionna confirms a phone number: she is enforced from now on.
insert into two_step_methods (user_id, kind, label, phone) values (:fin, 'sms', 'Text to ••• 4821', '+12045554821');
select t_assert((select array_agg(x order by x) from mfa_enforced_logins() x) = array[:owner::uuid, :fin::uuid], 'a confirmed phone number enforces the login');
reset role; select t_token(:fin, :f1, 'aal1'); set role authenticated;
select t_assert(not has_role(:fin, 'finance') and not has_permission(:fin, 'finance.read') and not is_admin_viewer(),
  'once a phone is confirmed, a password-only session has no finance rights');

-- Her session is confirmed by a texted code.
reset role; select t_service(); set role service_role;
select t_assert(two_step_session_mark(:fin, :f1, 'sms'), 'the server marks her session confirmed');
select t_assert(not two_step_session_mark(:fin, :a1, 'sms'), 'a session that isn''t hers is never marked');
select t_assert(not two_step_session_mark(:fin, '99999999-0000-0000-0000-000000000000', 'sms'), 'a session that doesn''t exist is never marked');
reset role; select t_token(:fin, :f1, 'aal1'); set role authenticated;
select t_assert(has_role(:fin, 'finance') and has_permission(:fin, 'finance.read') and is_admin_viewer(), 'the confirmed session has her rights back');
reset role; select t_token(:fin, :f2, 'aal1'); set role authenticated;
select t_assert(not has_role(:fin, 'finance'), 'her other session, not confirmed, still has none');
reset role; select t_token(:fin, :a1, 'aal1'); set role authenticated;
select t_assert(not has_role(:fin, 'finance'), 'a token naming someone else''s confirmed session gets nothing');

-- Signing out ends it.
reset role;
delete from auth.sessions where id = :f1;
select t_token(:fin, :f1, 'aal1'); set role authenticated;
select t_assert(not has_role(:fin, 'finance'), 'a signed-out session stops counting at once, even with its old token');
reset role;
insert into auth.sessions (id, user_id, not_after) values ('f3000000-0000-0000-0000-000000000003', :fin, now() - interval '1 minute');
select t_service(); set role service_role;
select two_step_session_mark(:fin, 'f3000000-0000-0000-0000-000000000003', 'sms');
reset role; select t_token(:fin, 'f3000000-0000-0000-0000-000000000003', 'aal1'); set role authenticated;
select t_assert(not has_role(:fin, 'finance'), 'a session past its time limit stops counting');

-- The owner can be confirmed without the authenticator app too (Face ID, a text).
reset role; select t_service(); set role service_role;
select two_step_session_mark(:owner, :a2, 'passkey');
reset role; select t_token(:owner, :a2, 'aal1'); set role authenticated;
select t_assert(has_role(:owner, 'admin') and is_business_owner(:owner), 'a session confirmed by passkey has the owner''s rights');
reset role; select t_token(:owner, :a1, 'aal1'); set role authenticated;
select t_assert(not has_role(:owner, 'admin'), 'and the owner''s other, unconfirmed session still has none');
-- asking about someone else is unaffected (the server, checks on other people)
select t_assert(has_role(:fin, 'finance'), 'asking whether someone else holds a role is unchanged');

-- ════ 3. Texted codes ═══════════════════════════════════════════════════════
reset role; select t_service(); set role service_role;
select t_assert((two_step_code_issue(:fin, :f2, 'sign_in', '+12045554821', null, :h1) ->> 'ok')::boolean, 'a code is issued');
select t_assert(two_step_code_issue(:fin, :f2, 'sign_in', '+12045554821', null, :h2) ->> 'reason' = 'cooldown', 'a second code within 30 seconds waits');
select t_assert((two_step_code_issue(:fin, :f2, 'sign_in', '+12045554821', null, :h2) ->> 'wait_s')::int between 1 and 30, 'and says how long');
select t_assert(two_step_code_check(:fin, :f2, 'sign_in', :h2) ->> 'reason' = 'wrong', 'a wrong code is wrong');
select t_assert((two_step_code_check(:fin, :f2, 'sign_in', :h2) ->> 'left')::int = 3, 'and counts down the tries left');
select t_assert(two_step_code_check(:fin, 'f2000000-0000-0000-0000-00000000ffff', 'sign_in', :h1) ->> 'reason' = 'none', 'a code works only for the session it was sent for');
select t_assert(two_step_code_check(:fin, :f2, 'add_phone', :h1) ->> 'reason' = 'none', 'and only for what it was sent for');
select t_assert((two_step_code_check(:fin, :f2, 'sign_in', :h1) ->> 'ok')::boolean, 'the right code works');
select t_assert(two_step_code_check(:fin, :f2, 'sign_in', :h1) ->> 'reason' = 'none', 'and only once');

-- Expired.
update two_step_codes set created_at = created_at - interval '1 minute';
select two_step_code_issue(:fin, :f2, 'sign_in', '+12045554821', null, :h1);
update two_step_codes set expires_at = now() - interval '1 second' where used_at is null and dead_at is null;
select t_assert(two_step_code_check(:fin, :f2, 'sign_in', :h1) ->> 'reason' = 'expired', 'an expired code is refused');

-- Five wrong tries kill a code.
update two_step_codes set created_at = created_at - interval '1 minute';
select two_step_code_issue(:fin, :f2, 'sign_in', '+12045554821', null, :h1);
select two_step_code_check(:fin, :f2, 'sign_in', :h2) from generate_series(1, 4);
select t_assert(two_step_code_check(:fin, :f2, 'sign_in', :h2) ->> 'reason' = 'used_up', 'the fifth wrong try uses the code up');
select t_assert(two_step_code_check(:fin, :f2, 'sign_in', :h1) ->> 'reason' = 'none', 'and then even the right code is refused');

-- A newer code replaces the older one.
update two_step_codes set created_at = created_at - interval '1 minute';
select two_step_code_issue(:fin, :f2, 'sign_in', '+12045554821', null, :h1);
update two_step_codes set created_at = created_at - interval '1 minute';
select two_step_code_issue(:fin, :f2, 'sign_in', '+12045554821', null, :h2);
select t_assert(two_step_code_check(:fin, :f2, 'sign_in', :h1) ->> 'reason' = 'wrong', 'a resent code replaces the first');
select t_assert((two_step_code_check(:fin, :f2, 'sign_in', :h2) ->> 'ok')::boolean, 'the newest code works');

-- Five codes an hour.
select t_assert((select count(*) from two_step_codes where user_id = :fin and created_at > now() - interval '1 hour') = 5, 'five codes so far this hour');
update two_step_codes set created_at = created_at - interval '1 minute';
select t_assert(two_step_code_issue(:fin, :f2, 'sign_in', '+12045554821', null, :h1) ->> 'reason' = 'hourly', 'the sixth code in an hour waits');

-- Ten a day.
update two_step_codes set created_at = created_at - interval '2 hours';
insert into two_step_codes (user_id, session_id, purpose, phone, code_hash, expires_at, created_at, dead_at)
select :fin, :f2, 'sign_in', '+12045554821', :h1, now(), now() - interval '3 hours', now() from generate_series(1, 5);
select t_assert(two_step_code_issue(:fin, :f2, 'sign_in', '+12045554821', null, :h1) ->> 'reason' = 'daily', 'the eleventh code in a day waits');

-- Ten wrong tries in an hour lock the login's codes, sending and checking.
delete from two_step_codes where user_id = :fin;
select two_step_code_issue(:coach, :c1, 'add_phone', '+12045550000', null, :h1);
update two_step_codes set created_at = created_at - interval '1 minute';
insert into staff_mfa_events (user_id, kind, actor_id) select :coach, 'sms_wrong', :coach from generate_series(1, 10);
select t_assert(two_step_code_check(:coach, :c1, 'add_phone', :h1) ->> 'reason' = 'locked', 'ten wrong tries in an hour lock checking, even the right code');
select t_assert(two_step_code_issue(:coach, :c1, 'add_phone', '+12045550000', null, :h1) ->> 'reason' = 'locked', 'and sending');
update staff_mfa_events set created_at = now() - interval '61 minutes' where user_id = :coach;
select t_assert((two_step_code_check(:coach, :c1, 'add_phone', :h1) ->> 'ok')::boolean, 'an hour later it works again');

-- A text that didn't go: dead, still counted.
select two_step_code_unsent(id) from two_step_codes where user_id = :coach;
select t_assert((select count(*) from two_step_codes where user_id = :coach and dead_at is null and used_at is null) = 0, 'an unsent code can''t be used');

-- ════ 4. Trusted devices ════════════════════════════════════════════════════
select two_step_trust_add(:fin, lpad(to_hex(n), 64, '0'), 'Device ' || n, 30) from generate_series(1, 10) n;
update two_step_trusted_devices set created_at = now() - make_interval(mins => 20 - substr(label, 8)::int) where user_id = :fin;
select two_step_trust_add(:fin, lpad(to_hex(11), 64, '0'), 'Device 11', 30);
select t_assert((select count(*) from two_step_trusted_devices where user_id = :fin and revoked_at is null) = 10
  and (select revoked_at is not null from two_step_trusted_devices where label = 'Device 1'), 'at most ten trusted devices, the oldest go');
update two_step_trusted_devices set created_at = created_at - interval '1 minute' where label = 'Device 11';
select t_assert((select expires_at from two_step_trusted_devices where label = 'Device 11') between now() + interval '29 days 23 hours' and now() + interval '30 days 1 minute', 'a device is trusted for 30 days');
select two_step_trust_add(:fin, lpad('ab', 64, '0'), 'Too long', 365);
select t_assert((select expires_at from two_step_trusted_devices where label = 'Too long') < now() + interval '30 days 1 minute', 'never longer than 30 days');
reset role; insert into auth.sessions (id, user_id) values ('f4000000-0000-0000-0000-000000000004', :fin);
select t_service(); set role service_role;
select t_assert(two_step_trust_use(:fin, 'f4000000-0000-0000-0000-000000000004', lpad(to_hex(11), 64, '0')), 'a trusted device confirms a new session');
select t_assert(two_step_session_live(:fin, 'f4000000-0000-0000-0000-000000000004'), 'that session is live');
select t_assert(not two_step_trust_use(:fin, :f2, lpad(to_hex(1), 64, '0')), 'a device that was pushed out no longer works');
select t_assert(not two_step_trust_use(:owner, :a1, lpad(to_hex(11), 64, '0')), 'someone else''s device token never works');
update two_step_trusted_devices set expires_at = now() - interval '1 second' where label = 'Device 10';
select t_assert(not two_step_trust_use(:fin, :f2, lpad(to_hex(10), 64, '0')), 'an expired trusted device doesn''t work');
select t_assert(two_step_trust_forget(:fin, (select id from two_step_trusted_devices where label = 'Device 9')) = 1, 'forget one');
select t_assert(not two_step_trust_use(:fin, :f2, lpad(to_hex(9), 64, '0')), 'a forgotten device doesn''t work');
select t_assert(two_step_trust_forget(:fin) >= 1 and not two_step_trust_use(:fin, :f2, lpad(to_hex(11), 64, '0')), 'forget all');

-- ════ 5. Removing a way and the owner's reset ═══════════════════════════════
update two_step_methods set removed_at = now() where user_id = :fin;
select t_assert(not two_step_login_has(:fin), 'removing the last way takes the login off the enforced list');
reset role; select t_token(:fin, :f2, 'aal1'); set role authenticated;
select t_assert(has_role(:fin, 'finance'), 'and its sessions are as before');
reset role; select t_service(); set role service_role;
insert into two_step_methods (user_id, kind, label, credential_id, public_key, alg, rp_id)
values (:fin, 'passkey', 'Face ID · iPhone', 'AAAAAAAAAAAAAAAAAAAAAA', '{"kty":"EC"}', -7, 'jfeffect.com');
select two_step_session_mark(:fin, :f2, 'passkey');
select two_step_trust_add(:fin, :h2, 'iPhone', 30);
select staff_mfa_reset_record(:fin, :owner);
select t_assert(not two_step_login_has(:fin) and not two_step_session_live(:fin, :f2)
  and not exists (select 1 from two_step_trusted_devices where user_id = :fin and revoked_at is null),
  'the owner''s reset removes every way, every confirmed session and every trusted device');
select t_assert((select kind from staff_mfa_events where user_id = :fin order by created_at desc limit 1) = 'reset_by_owner', 'and records it');

-- ════ 6. Nobody but the server touches any of it ════════════════════════════
reset role; select t_token(:fin, :f2, 'aal1'); set role authenticated;
do $$ begin
  perform 1 from two_step_methods;
  raise exception 'ASSERT FAILED: a signed-in user read two_step_methods';
exception when insufficient_privilege then raise notice 'ok: a signed-in user can''t read the methods';
end $$;
do $$ begin
  perform 1 from two_step_trusted_devices;
  raise exception 'ASSERT FAILED: a signed-in user read two_step_trusted_devices';
exception when insufficient_privilege then raise notice 'ok: a signed-in user can''t read trusted devices';
end $$;
do $$ begin
  perform two_step_session_mark('00000000-0000-0000-0000-00000000000f', 'f2000000-0000-0000-0000-000000000002', 'sms');
  raise exception 'ASSERT FAILED: a signed-in user marked their own session';
exception when insufficient_privilege then raise notice 'ok: a signed-in user can''t mark their own session confirmed';
end $$;
do $$ begin
  perform two_step_code_issue('00000000-0000-0000-0000-00000000000f', 'f2000000-0000-0000-0000-000000000002', 'sign_in', '+12045554821', null, repeat('1', 64));
  raise exception 'ASSERT FAILED: a signed-in user issued a code';
exception when insufficient_privilege then raise notice 'ok: a signed-in user can''t issue codes';
end $$;
do $$ begin
  insert into two_step_sessions (session_id, user_id, method) values ('f2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000f', 'sms');
  raise exception 'ASSERT FAILED: a signed-in user wrote a confirmed session';
exception when insufficient_privilege then raise notice 'ok: a signed-in user can''t write a confirmed session';
end $$;
reset role; select set_config('request.jwt.claims', '', false); set role anon;
do $$ begin
  perform mfa_enforced_logins();
  raise exception 'ASSERT FAILED: anyone read the enforced list';
exception when insufficient_privilege then raise notice 'ok: nobody signed out can read who is enforced';
end $$;
reset role;
-- No recovery codes (20270513100000_no_recovery_codes.sql): none kept, nothing makes or takes one.
do $$ begin
  if exists (select 1 from staff_mfa_recovery_codes) then
    raise exception 'ASSERT FAILED: recovery codes are still stored';
  end if;
  if exists (select 1 from pg_proc where proname in ('staff_mfa_recovery_replace', 'staff_mfa_recovery_use', 'staff_mfa_recovery_left')) then
    raise exception 'ASSERT FAILED: a recovery-code function is still there';
  end if;
  if not exists (select 1 from pg_proc where proname = 'staff_mfa_reset_record') then
    raise exception 'ASSERT FAILED: the owner''s reset went with them';
  end if;
  raise notice 'ok: no recovery codes, and the owner''s reset is kept';
end $$;
select 'two-step: all assertions passed';
