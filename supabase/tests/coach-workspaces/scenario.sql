-- Two independent businesses beside JF Effect, checked as every person.
\set ON_ERROR_STOP 1

-- ── 1. Before any business exists, nothing changes for JF Effect ──────────
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1');
select t_assert(tenant_fence_mode() = 'open', 'no independent business: the fence is open');
select t_count_all('jared', 'open');
select t_as('00000000-0000-0000-0000-0000000000c1'); select t_count_all('ana', 'open');
select t_as('00000000-0000-0000-0000-0000000000d1'); select t_count_all('marc', 'open');
select t_as('00000000-0000-0000-0000-0000000000e1'); select t_count_all('mia', 'open');
select t_as('00000000-0000-0000-0000-0000000000f1'); select t_count_all('olivia', 'open');
reset role;
select t_assert(not exists (
  select 1 from t_seen b join t_seen a on a.who = b.who and a.tbl = b.tbl and a.phase = 'open'
   where b.phase = 'before' and a.n <> b.n), 'every JF Effect person sees exactly what they saw before the migration');
select t_assert((select count(*) from t_seen where phase = 'open') = 70, 'all 70 counts compared');

-- ── 2. The pilot is off: nobody can make a workspace ─────────────────────
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  perform coach_workspace_create('00000000-0000-0000-0000-0000000000f1', 'Strong Coaching', 'strong-coaching', 'CA', 'MB');
  raise exception 'ASSERT FAILED: made a workspace with the pilot off';
exception when sqlstate '55000' then raise notice 'ok: the pilot is off, no workspace';
end $$;

-- only the owner switches the pilot, and it switches on only with the fence complete
select t_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  perform coach_workspaces_set_pilot(true);
  raise exception 'ASSERT FAILED: a JF coach switched the pilot on';
exception when sqlstate '42501' then raise notice 'ok: a JF coach can''t switch the pilot';
end $$;
reset role;
drop policy tenant_fence on community_posts;
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  perform coach_workspaces_set_pilot(true);
  raise exception 'ASSERT FAILED: pilot on with a table unfenced';
exception when sqlstate '55000' then
  if sqlerrm not like '%community_posts%' then raise exception 'ASSERT FAILED: wrong table named: %', sqlerrm; end if;
  raise notice 'ok: the pilot won''t go on while community_posts is unfenced (named in the error)';
end $$;
reset role;
select tenant_fence_apply();
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1');
select coach_workspaces_set_pilot(true);
select t_assert(coach_workspaces_pilot_on(), 'pilot on once every client table is fenced');

-- a JF coach can't make a workspace; the owner can
select t_as('00000000-0000-0000-0000-0000000000c1');
do $$ begin
  perform coach_workspace_create('00000000-0000-0000-0000-0000000000c1', 'Ana Inc', 'ana-inc', 'CA', 'MB');
  raise exception 'ASSERT FAILED: a JF coach made a workspace';
exception when sqlstate '42501' then raise notice 'ok: only the platform owner makes a workspace';
end $$;
select t_as('00000000-0000-0000-0000-0000000000a1');
create temp table t_org (k text primary key, id uuid);
grant all on t_org to authenticated;
insert into t_org values ('A', coach_workspace_create('00000000-0000-0000-0000-0000000000f1', 'Strong Coaching', 'strong-coaching', 'CA', 'MB'));
insert into t_org values ('B', coach_workspace_create('00000000-0000-0000-0000-0000000000b1', 'Bo Barbell', 'bo-barbell', 'US', 'MN'));
reset role;
select t_assert((select pricing ->> 'per_client_cents' from organization_billing where org_id = (select id from t_org where k = 'A')) = '500'
  and (select pricing ->> 'volume_from' from organization_billing where org_id = (select id from t_org where k = 'A')) = '26'
  and (select pricing ->> 'volume_cents' from organization_billing where org_id = (select id from t_org where k = 'A')) = '300',
  'the business keeps the price it was made with ($5, $3 from client 26)');
select t_assert(not exists (select 1 from user_roles where user_id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1') and role <> 'client'),
  'owning a workspace gives no JF Effect role');
select t_assert(not exists (select 1 from coaches where user_id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1')),
  'and no JF Effect coach record');

-- ── 3. Invitations ───────────────────────────────────────────────────────
set role authenticated;
-- Olivia brings Cole onto her team
select t_as('00000000-0000-0000-0000-0000000000f1');
select org_invite((select id from t_org where k = 'A'), 'member', 'Cole@Example.test', t_hash('tok-cole'), 'coach');
select t_as('00000000-0000-0000-0000-0000000000f2');
select t_assert((org_invitation_accept('tok-cole', null, null) ->> 'ok')::boolean, 'Cole joins Strong Coaching as a coach');
select t_assert(not has_role('00000000-0000-0000-0000-0000000000f2', 'coach'), 'Cole gets no JF Effect coach role');
-- a coach can't invite teammates; their client invitations are always theirs
do $$ begin
  perform org_invite((select id from t_org where k = 'A'), 'member', 'x@example.test', t_hash('tok-x'), 'admin');
  raise exception 'ASSERT FAILED: a coach invited a teammate';
exception when sqlstate '42501' then raise notice 'ok: only the owner invites teammates';
end $$;
select org_invite((select id from t_org where k = 'A'), 'client', 'priya@example.test', t_hash('tok-priya'), null,
  '00000000-0000-0000-0000-0000000000f1');
reset role;
select t_assert((select assign_to from organization_invitations where email = 'priya@example.test') = '00000000-0000-0000-0000-0000000000f2',
  'a coach''s client invitation is assigned to them whatever they asked');
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000f1');
select org_invite((select id from t_org where k = 'A'), 'client', 'quinn@example.test', t_hash('tok-quinn'));
select org_invite((select id from t_org where k = 'A'), 'client', 'marc@example.test', t_hash('tok-marc'));
select org_invite((select id from t_org where k = 'A'), 'client', 'olivia@example.test', t_hash('tok-olivia'));
select t_as('00000000-0000-0000-0000-0000000000b1');
select org_invite((select id from t_org where k = 'B'), 'client', 'bea@example.test', t_hash('tok-bea'));
-- Bo can't invite into Olivia's business
do $$ begin
  perform org_invite((select id from t_org where k = 'A'), 'client', 'z@example.test', t_hash('tok-z'));
  raise exception 'ASSERT FAILED: Bo invited into Strong Coaching';
exception when sqlstate '42501' then raise notice 'ok: one business can''t invite into another';
end $$;

-- peeking needs no sign-in and says only the business and whether it's open
reset role; set role anon;
select t_assert(org_invitation_peek('tok-priya') ->> 'state' = 'open' and org_invitation_peek('tok-priya') ->> 'business' = 'Strong Coaching',
  'a link shows the business and that it''s open, signed out');
select t_assert(org_invitation_peek('nope') ->> 'state' = 'invalid' and org_invitation_peek('nope') ->> 'business' is null,
  'a wrong token says invalid and nothing else');
reset role; set role authenticated;

-- the link alone isn't enough: Mia opens Priya's link signed in as herself
select t_as('00000000-0000-0000-0000-0000000000e1');
select t_assert(org_invitation_accept('tok-priya', 'v1', 'I agree to share my training records with my coach.') ->> 'reason' = 'wrong_login',
  'a forwarded link won''t accept for someone else''s login');
-- Quinn hasn't confirmed her email
select t_as('00000000-0000-0000-0000-0000000000a6');
select t_assert(org_invitation_accept('tok-quinn', 'v1', 'I agree to share my training records with my coach.') ->> 'reason' = 'wrong_login',
  'an unconfirmed email can''t accept');
-- Marc already trains with JF Effect: one record per login in the pilot
select t_as('00000000-0000-0000-0000-0000000000d1');
select t_assert(org_invitation_accept('tok-marc', 'v1', 'I agree to share my training records with my coach.') ->> 'reason' = 'already_athlete',
  'a JF Effect client can''t be pulled into another business');
-- Olivia can't be her own client
select t_as('00000000-0000-0000-0000-0000000000f1');
select t_assert(org_invitation_accept('tok-olivia', 'v1', 'I agree to share my training records with my coach.') ->> 'reason' = 'on_team',
  'a team member can''t accept a client invitation from their own business');
-- consent is required
select t_as('00000000-0000-0000-0000-0000000000a5');
do $$ begin
  perform org_invitation_accept('tok-priya', 'v1', 'ok');
  raise exception 'ASSERT FAILED: accepted without consent text';
exception when sqlstate '22023' then raise notice 'ok: consent is required to accept';
end $$;
select t_assert((org_invitation_accept('tok-priya', 'client-consent-v1', 'I agree to share my training, nutrition and progress records with Strong Coaching.') ->> 'ok')::boolean,
  'Priya accepts with her consent');
do $$ begin
  perform org_invitation_accept('tok-priya', 'v1', 'I agree to share my training records with my coach.');
  raise exception 'ASSERT FAILED: an invitation accepted twice';
exception when sqlstate '55000' then raise notice 'ok: an accepted invitation can''t be used again';
end $$;
select t_as('00000000-0000-0000-0000-0000000000b5');
select t_assert((org_invitation_accept('tok-bea', 'client-consent-v1', 'I agree to share my training, nutrition and progress records with Bo Barbell.') ->> 'ok')::boolean,
  'Bea accepts Bo''s invitation');
reset role;
-- Quinn confirms her email, then accepts
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000a6';
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a6');
select t_assert((org_invitation_accept('tok-quinn', 'client-consent-v1', 'I agree to share my training, nutrition and progress records with Strong Coaching.') ->> 'ok')::boolean,
  'Quinn accepts once her email is confirmed');
reset role;
select t_assert((select organization_id from clients where user_id = '00000000-0000-0000-0000-0000000000a5') = (select id from t_org where k = 'A')
  and (select service_tier from clients where user_id = '00000000-0000-0000-0000-0000000000a5') = 'org_coaching',
  'Priya''s record lives in Strong Coaching as org_coaching');
select t_assert((select consent_text from organization_clients oc join clients c on c.id = oc.client_id where c.user_id = '00000000-0000-0000-0000-0000000000a5')
  like 'I agree to share%Strong Coaching.', 'her consent is kept word for word');

-- a locked link after 5 wrong logins
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000f1');
select org_invite((select id from t_org where k = 'A'), 'client', 'locked@example.test', t_hash('tok-locked'));
select t_as('00000000-0000-0000-0000-0000000000e9');
select org_invitation_accept('tok-locked', 'v1', 'I agree to share my training records with my coach.') from generate_series(1, 5);
select t_assert(org_invitation_peek('tok-locked') ->> 'state' = 'locked', 'five wrong logins lock the link');

-- their records: each business's clients log training
reset role;
insert into pl_row_results (client_id, actual_load)
  select id, 50 from clients where user_id in ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000b5');
insert into progress_bodyweight (user_id, weight_value) values
  ('00000000-0000-0000-0000-0000000000a5', 70), ('00000000-0000-0000-0000-0000000000a6', 65), ('00000000-0000-0000-0000-0000000000b5', 90);
insert into community_posts (client_id, caption) select id, 'Bea post' from clients where user_id = '00000000-0000-0000-0000-0000000000b5';
insert into messages (client_id, body) select id, 'Bea to Bo' from clients where user_id = '00000000-0000-0000-0000-0000000000b5';

-- ── 4. Isolation, as every person ────────────────────────────────────────
set role authenticated;
-- JF Effect's people see exactly what they saw before: no other business's records
select t_as('00000000-0000-0000-0000-0000000000a1');
select t_assert(tenant_fence_mode() = 'hide', 'Jared reads in hide mode');
select t_count_all('jared', 'hide');
select t_as('00000000-0000-0000-0000-0000000000c1'); select t_count_all('ana', 'hide');
select t_as('00000000-0000-0000-0000-0000000000d1'); select t_count_all('marc', 'hide');
select t_as('00000000-0000-0000-0000-0000000000e1'); select t_count_all('mia', 'hide');
reset role;
select t_assert(not exists (
  select 1 from t_seen b join t_seen a on a.who = b.who and a.tbl = b.tbl and a.phase = 'hide'
   where b.phase = 'before' and a.n <> b.n), 'with two businesses running, every JF Effect person (admin included) sees exactly what they did before');

set role authenticated;
-- the platform admin, by direct id: nothing
select t_as('00000000-0000-0000-0000-0000000000a1');
select t_assert((select count(*) from clients where organization_id <> jf_org_id()) = 0, 'Jared can''t read another business''s client records');
select t_assert((select count(*) from progress_bodyweight where user_id = '00000000-0000-0000-0000-0000000000a5') = 0, 'nor Priya''s weigh-ins');
select t_assert((select count(*) from organization_clients) = 0, 'nor any business''s roster');
reset role;
create temp table t_priya as select id from clients where user_id = '00000000-0000-0000-0000-0000000000a5';
create temp table t_quinn as select id from clients where user_id = '00000000-0000-0000-0000-0000000000a6';
create temp table t_bea as select id from clients where user_id = '00000000-0000-0000-0000-0000000000b5';
grant select on t_priya, t_quinn, t_bea to authenticated;
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  insert into pl_blocks (client_id, name) values ((select id from t_priya), 'admin block');
  raise exception 'ASSERT FAILED: the platform admin wrote into Priya''s program';
exception when insufficient_privilege then raise notice 'ok: the platform admin can''t write into another business''s client';
end $$;

-- Olivia: her business's clients (and, as a JF member, the crew she's in), never Bo's
select t_as('00000000-0000-0000-0000-0000000000f1');
select t_assert(tenant_fence_mode() = 'hide', 'Olivia (a JF member and a business owner) reads in hide mode');
select t_assert((select count(*) from clients where id in (select id from t_priya union select id from t_quinn)) = 2, 'Olivia sees both her clients');
select t_assert((select count(*) from clients where id = (select id from t_bea)) = 0, 'Olivia doesn''t see Bo''s client');
select t_assert((select count(*) from clients where user_id = '00000000-0000-0000-0000-0000000000d1') = 0, 'nor JF Effect''s clients');
select t_assert((select count(*) from pl_row_results where client_id = (select id from t_priya)) = 1, 'she reads Priya''s logs');
select t_assert((select count(*) from pl_row_results where client_id = (select id from t_bea)) = 0, 'not Bea''s');
select t_assert((select count(*) from progress_bodyweight where user_id = '00000000-0000-0000-0000-0000000000a5') = 1, 'she reads Priya''s weigh-ins');
select t_assert((select count(*) from community_posts where caption = 'Bea post') = 0, 'the loose crew policy still never shows Bea''s post to her');
select t_assert((select count(*) from messages) = 0, 'and no messages: they aren''t opened to a business yet');
select t_assert((select count(*) from organization_clients) = 2, 'she sees her two relationships');

-- Cole: only the client assigned to him, and nothing of JF Effect at all
select t_as('00000000-0000-0000-0000-0000000000f2');
select t_assert(tenant_fence_mode() = 'allow', 'Cole (only in a business) reads in allow mode');
select t_assert((select count(*) from clients) = 1 and (select id from clients) = (select id from t_priya), 'Cole sees only Priya');
select t_assert((select count(*) from community_posts) = 0, 'the loose crew policy shows Cole nothing (Marc''s and Mia''s posts fenced out)');
select t_assert((select count(*) from pl_row_results) = 1, 'Cole reads one client''s logs');
select t_assert((select count(*) from payment_ledger) = 0, 'and no JF Effect money');

-- Priya: her own, never Quinn's, never the crew
select t_as('00000000-0000-0000-0000-0000000000a5');
select t_assert(tenant_fence_mode() = 'allow', 'Priya reads in allow mode');
select t_assert((select count(*) from clients) = 1, 'Priya sees her own record');
select t_assert((select count(*) from pl_row_results) = 1 and (select count(*) from progress_bodyweight) = 1, 'and her own logs');
select t_assert((select count(*) from community_posts) = 0, 'she isn''t in JF Effect''s crew');
select t_assert((select name from organizations where id = (select id from t_org where k = 'A')) = 'Strong Coaching', 'she reads her coach''s business name');
select t_assert((select count(*) from organizations) = 1, 'and no other business');

-- Bo: Bea only
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_assert((select count(*) from clients) = 1 and (select id from clients) = (select id from t_bea), 'Bo sees only Bea');
select t_assert((select count(*) from pl_row_results) = 1 and (select count(*) from progress_bodyweight) = 1, 'and only her logs');
select t_assert((select count(*) from community_posts) = 1, 'Bea''s post, which is his client''s');

-- Mia (a JF member) sees the crew's posts, never Bea's
select t_as('00000000-0000-0000-0000-0000000000e1');
select t_assert((select count(*) from community_posts) = 2, 'Mia sees JF Effect''s two crew posts and not Bea''s');

-- Sam (a login and nothing else): nothing
select t_as('00000000-0000-0000-0000-0000000000e9');
select t_assert(tenant_fence_mode() = 'allow', 'a bare login reads in allow mode');
select t_assert((select count(*) from community_posts) + (select count(*) from clients) + (select count(*) from pl_row_results) = 0,
  'a bare login sees no one''s records');

-- ── 5. Writes ────────────────────────────────────────────────────────────
select t_as('00000000-0000-0000-0000-0000000000f2');
insert into pl_blocks (client_id, name) values ((select id from t_priya), 'Priya block 1');
select t_assert((select count(*) from pl_blocks where name = 'Priya block 1') = 1, 'Cole writes Priya''s program');
insert into pl_weeks (block_id, week_index) select id, 1 from pl_blocks where name = 'Priya block 1';
insert into pl_days (week_id, title) select w.id, 'Day 1' from pl_weeks w join pl_blocks b on b.id = w.block_id where b.name = 'Priya block 1';
insert into pl_exercise_rows (day_id, sets) select d.id, 5 from pl_days d join pl_weeks w on w.id = d.week_id join pl_blocks b on b.id = w.block_id where b.name = 'Priya block 1';
select t_assert((select count(*) from pl_exercise_rows) = 1, 'and its weeks, days and exercises');
do $$ begin
  insert into pl_blocks (client_id, name) values ((select id from t_quinn), 'not his');
  raise exception 'ASSERT FAILED: Cole wrote a program for a client who isn''t his';
exception when insufficient_privilege then raise notice 'ok: Cole can''t write for Quinn (not assigned)';
end $$;
do $$ begin
  insert into pl_blocks (client_id, name) values ('00000000-0000-0000-0000-0000000c1e01', 'jf');
  raise exception 'ASSERT FAILED: Cole wrote into a JF Effect client';
exception when insufficient_privilege then raise notice 'ok: Cole can''t write for a JF Effect client';
end $$;
do $$ begin
  insert into pl_row_results (client_id, actual_load) values ((select id from t_priya), 999);
  raise exception 'ASSERT FAILED: a coach logged a set';
exception when insufficient_privilege then raise notice 'ok: what a client logged is theirs (the team reads it only)';
end $$;
-- Priya logs her own set
select t_as('00000000-0000-0000-0000-0000000000a5');
insert into pl_row_results (client_id, actual_load) values ((select id from t_priya), 55);
select t_assert((select count(*) from pl_row_results) = 2, 'Priya logs her own set');
select t_assert((select count(*) from pl_exercise_rows) = 0, 'she has no read rule on prescribed rows here (JF''s own rule decides), and the fence lets nothing extra through');
-- Marc (JF) can't write into Priya
select t_as('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  insert into pl_row_results (client_id, actual_load) values ((select id from t_priya), 1);
  raise exception 'ASSERT FAILED: Marc wrote into Priya';
exception when insufficient_privilege then raise notice 'ok: a JF client can''t write into another business';
end $$;

-- ── 6. Seats ─────────────────────────────────────────────────────────────
reset role;
create temp view t_billA as select * from organization_billing where org_id = (select id from t_org where k = 'A');
select t_assert((select seats from t_billA) = 2 and (select paid_seats from t_billA) = 1, 'Strong Coaching: 2 clients, 1 paid (first free)');
select t_assert((select state from t_billA) = 'needs_setup' and (select needs_setup_since from t_billA) is not null, 'a paid client with no card: needs setup');
select t_assert((select seats from organization_billing where org_id = (select id from t_org where k = 'B')) = 1
  and (select paid_seats from organization_billing where org_id = (select id from t_org where k = 'B')) = 0
  and (select state from organization_billing where org_id = (select id from t_org where k = 'B')) = 'free', 'Bo Barbell: 1 client, free');
create temp table t_rev as select seat_revision from t_billA;
-- pending invitations are free
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000f1');
select org_invite((select id from t_org where k = 'A'), 'client', 'later@example.test', t_hash('tok-later'));
reset role;
select t_assert((select seats from t_billA) = 2, 'a pending invitation isn''t a seat');
-- pausing frees a seat, resuming takes it back
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000f1');
select org_client_set_status((select id from t_org where k = 'A'), (select id from t_quinn), 'paused');
reset role;
select t_assert((select seats from t_billA) = 1 and (select paid_seats from t_billA) = 0 and (select state from t_billA) = 'free', 'paused: back to one free seat');
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000f1');
select org_client_set_status((select id from t_org where k = 'A'), (select id from t_quinn), 'active');
reset role;
select t_assert((select seats from t_billA) = 2, 'resumed: two seats');
select t_assert((select seat_revision from t_billA) = (select seat_revision from t_rev) + 2, 'each change in the count is one revision (for idempotent seat syncs)');
-- an archived record isn't a seat
update clients set archived = true where id = (select id from t_quinn);
select t_assert((select seats from t_billA) = 1, 'an archived client isn''t a seat');
update clients set archived = false where id = (select id from t_quinn);
select t_assert((select seats from t_billA) = 2, 'and counts again when put back');

-- ── 7. Billing lapse: reading stays, writing stops ───────────────────────
update organization_billing set needs_setup_since = now() - interval '15 days' where org_id = (select id from t_org where k = 'A');
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000f2');
select t_assert(not org_can_write((select id from t_org where k = 'A')), '14 days with a paid client and no card: read only');
do $$ begin
  insert into pl_blocks (client_id, name) values ((select id from t_priya), 'blocked');
  raise exception 'ASSERT FAILED: wrote while billing had lapsed';
exception when insufficient_privilege then raise notice 'ok: no program writes while billing has lapsed';
end $$;
select t_assert((select count(*) from pl_blocks) = 1, 'but Cole still reads what''s there');
do $$ begin
  perform org_invite((select id from t_org where k = 'A'), 'client', 'more@example.test', t_hash('tok-more'));
  raise exception 'ASSERT FAILED: invited while billing had lapsed';
exception when sqlstate '42501' then raise notice 'ok: no new invitations while billing has lapsed';
end $$;
reset role;
update organization_billing set needs_setup_since = now() where org_id = (select id from t_org where k = 'A');

-- ── 8. Permissions and the team ──────────────────────────────────────────
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000f2');
do $$ begin
  perform org_client_set_status((select id from t_org where k = 'A'), (select id from t_quinn), 'ended');
  raise exception 'ASSERT FAILED: a coach ended a client';
exception when sqlstate 'P0002' then raise notice 'ok: a coach can''t end a client (clients.manage)';
end $$;
select t_as('00000000-0000-0000-0000-0000000000f1');
select org_member_permission_set((select id from t_org where k = 'A'), '00000000-0000-0000-0000-0000000000f2', 'clients.view_all', true);
select t_as('00000000-0000-0000-0000-0000000000f2');
select t_assert((select count(*) from clients) = 2, 'given clients.view_all, Cole sees the whole roster');
select t_as('00000000-0000-0000-0000-0000000000f1');
do $$ begin
  perform org_member_set((select id from t_org where k = 'A'), '00000000-0000-0000-0000-0000000000f1', 'coach');
  raise exception 'ASSERT FAILED: the last owner demoted herself';
exception when sqlstate '55000' then raise notice 'ok: a workspace always has an owner';
end $$;
select org_member_set((select id from t_org where k = 'A'), '00000000-0000-0000-0000-0000000000f2', null);
select t_as('00000000-0000-0000-0000-0000000000f2');
select t_assert((select count(*) from clients) + (select count(*) from pl_blocks) + (select count(*) from pl_row_results) = 0,
  'taken off the team, Cole sees nothing at once');
reset role;
select t_assert((select assigned_user_id from organization_clients where client_id = (select id from t_priya)) is null,
  'his client is unassigned (the owner still sees her), never deleted');
select t_assert((select count(*) from organization_member_permissions where user_id = '00000000-0000-0000-0000-0000000000f2') = 0,
  'and his permission changes go with him');

-- ── 9. Support access ────────────────────────────────────────────────────
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1');
create temp table t_grant (id uuid);
grant all on t_grant to authenticated;
insert into t_grant select support_access_request((select id from t_org where k = 'A'), 'Coach reported a program that won''t save', 2);
select t_assert((select count(*) from clients where id = (select id from t_priya)) = 0, 'asking isn''t access: Jared still sees nothing');
select t_as('00000000-0000-0000-0000-0000000000b1');
do $$ begin
  perform support_access_decide((select id from t_grant), true);
  raise exception 'ASSERT FAILED: Bo approved support into Olivia''s business';
exception when sqlstate '42501' then raise notice 'ok: only that business''s owner approves';
end $$;
select t_as('00000000-0000-0000-0000-0000000000f1');
select support_access_decide((select id from t_grant), true);
select t_as('00000000-0000-0000-0000-0000000000a1');
select t_assert((select count(*) from clients where id = (select id from t_priya)) = 1, 'approved: Jared sees Strong Coaching''s clients');
select t_assert((select count(*) from clients where id = (select id from t_bea)) = 0, 'and still nothing of Bo''s');
reset role;
update support_access_grants set expires_at = now() - interval '1 minute' where id = (select id from t_grant);
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1');
select t_assert((select count(*) from clients where id = (select id from t_priya)) = 0, 'run out: hidden again');
reset role;
select t_assert((select count(*) from organization_audit_log where org_id = (select id from t_org where k = 'A') and action like 'support.%') = 2,
  'the business''s access record shows the request and the approval');

-- ── 10. The client ends it ───────────────────────────────────────────────
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a6');
select org_client_set_status((select id from t_org where k = 'A'), (select id from t_quinn), 'ended');
select t_assert((select count(*) from pl_row_results) = 1, 'Quinn still has her own records');
select t_as('00000000-0000-0000-0000-0000000000f1');
select t_assert((select count(*) from clients where id = (select id from t_quinn)) = 0
  and (select count(*) from pl_row_results where client_id = (select id from t_quinn)) = 0,
  'once Quinn ends it, Olivia sees none of her records');
reset role;
select t_assert((select end_reason from organization_clients where client_id = (select id from t_quinn)) = 'client_left', 'recorded as the client leaving');
select t_assert((select seats from t_billA) = 1 and (select state from t_billA) = 'free', 'and her seat is free');
-- only a new invitation brings her back
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000f1');
do $$ begin
  perform org_client_set_status((select id from t_org where k = 'A'), (select id from t_quinn), 'active');
  raise exception 'ASSERT FAILED: resumed an ended relationship without consent';
exception when sqlstate '55000' then raise notice 'ok: an ended relationship needs a new invitation';
end $$;
select org_invite((select id from t_org where k = 'A'), 'client', 'quinn@example.test', t_hash('tok-quinn-2'));
select t_as('00000000-0000-0000-0000-0000000000a6');
select t_assert((org_invitation_accept('tok-quinn-2', 'client-consent-v1', 'I agree to share my training, nutrition and progress records with Strong Coaching.') ->> 'ok')::boolean,
  'Quinn comes back with a new invitation (same record)');
reset role;
select t_assert((select count(*) from clients where user_id = '00000000-0000-0000-0000-0000000000a6') = 1, 'still one record for her login');
select t_assert((select seats from t_billA) = 2, 'two seats again');

-- ── 11. The record guard ─────────────────────────────────────────────────
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  update clients set organization_id = (select id from t_org where k = 'A') where id = '00000000-0000-0000-0000-0000000c1e01';
  raise exception 'ASSERT FAILED: moved Marc into another business';
exception when insufficient_privilege then raise notice 'ok: the admin can''t move a JF record into another business';
end $$;
reset role;
do $$ begin
  insert into clients (full_name, organization_id, service_tier) values ('Forged', (select id from t_org where k = 'A'), 'org_coaching');
  raise exception 'ASSERT FAILED: the server made a client in another business';
exception when insufficient_privilege then raise notice 'ok: even the server can''t place a record in a business outside the invitation';
end $$;
do $$ begin
  insert into clients (full_name, service_tier) values ('Mixed', 'org_coaching');
  raise exception 'ASSERT FAILED: an org_coaching record in JF Effect';
exception when others then raise notice 'ok: org_coaching only ever lives in an independent business';
end $$;

-- ── 12. The audit trail ──────────────────────────────────────────────────
select t_assert((select count(*) from organization_audit_log where org_id = (select id from t_org where k = 'A') and action = 'client.joined') = 3,
  'every acceptance is recorded (Priya, Quinn, Quinn again)');
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_assert((select count(*) from organization_audit_log where org_id = (select id from t_org where k = 'A')) = 0,
  'Bo can''t read Strong Coaching''s access record');
reset role;

-- ── 13. AI metering ──────────────────────────────────────────────────────
-- allowance 10 credits, a 3 µUSD-million cap, a day's cap of 1.2 million
create temp table t_use (id uuid);
insert into t_use select (org_ai_reserve((select id from t_org where k = 'A'), 'program_edit', 4, 200000, 10, 3000000, 1200000) ->> 'use_id')::uuid;
select t_assert((select status from org_ai_usage where id = (select id from t_use)) = 'reserved', 'credits are taken before the call');
select org_ai_settle((select id from t_use), true, 'gpt-5.5', 25000, 8000, 4000, 205000);
select t_assert((org_ai_state((select id from t_org where k = 'A')) ->> 'used')::int = 4
  and (org_ai_state((select id from t_org where k = 'A')) ->> 'spent_micro_usd')::bigint = 205000, 'settled: 4 credits used, its real cost kept');
select org_ai_settle((select id from t_use), false, 'x', 0, 0, 0, 999999999);
select t_assert((org_ai_state((select id from t_org where k = 'A')) ->> 'spent_micro_usd')::bigint = 205000, 'a use settles once');
-- a failed call gives its credits back but its cost still counts
truncate t_use;
insert into t_use select (org_ai_reserve((select id from t_org where k = 'A'), 'program_edit', 4, 200000, 10, 3000000, 1200000) ->> 'use_id')::uuid;
select org_ai_settle((select id from t_use), false, 'gpt-5.5', 25000, 0, 100, 128000);
select t_assert((org_ai_state((select id from t_org where k = 'A')) ->> 'used')::int = 4
  and (org_ai_state((select id from t_org where k = 'A')) ->> 'spent_micro_usd')::bigint = 333000, 'a failed call: credits back, cost counted');
-- out of allowance, then bought credits
select t_assert(org_ai_reserve((select id from t_org where k = 'A'), 'program_generate', 90, 4000000, 10, 9000000, 9000000) ->> 'reason' = 'out_of_credits', 'not enough credits says so');
insert into org_ai_credit_grants (org_id, credits, source, stripe_ref) values ((select id from t_org where k = 'A'), 100, 'pack', 'cs_test_1');
select t_assert(org_ai_reserve((select id from t_org where k = 'A'), 'program_generate', 90, 4000000, 10, 9000000, 9000000) ->> 'source' = 'purchased', 'bought credits pay for it');
select t_assert(org_ai_reserve((select id from t_org where k = 'A'), 'program_generate', 90, 4000000, 10, 9000000, 9000000) ->> 'reason' = 'out_of_credits', 'and only once');
-- the caps hold whatever the credits say
select t_assert(org_ai_reserve((select id from t_org where k = 'A'), 'checkin_summary', 0, 5000, 10, 300000, 9000000) ->> 'reason' = 'monthly_cap', 'the month''s cap stops even an included feature');
select t_assert(org_ai_reserve((select id from t_org where k = 'A'), 'checkin_summary', 0, 5000, 10, 9000000, 300000) ->> 'reason' = 'daily_cap', 'and the day''s');
-- another business's meter is its own
select t_assert((org_ai_state((select id from t_org where k = 'B')) ->> 'used')::int = 0, 'Bo''s meter is untouched');
-- a coach can't call the meter
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000f1');
do $$ begin
  perform org_ai_reserve((select id from t_org where k = 'A'), 'x', 0, 0, 1000, 999999999, 999999999);
  raise exception 'ASSERT FAILED: a signed-in person called the meter';
exception when insufficient_privilege then raise notice 'ok: only the server meters AI';
end $$;
select t_assert((select count(*) from org_ai_credit_grants) = 1, 'the owner reads her credits');
select t_as('00000000-0000-0000-0000-0000000000b1');
select t_assert((select count(*) from org_ai_credit_grants) + (select count(*) from org_ai_usage) = 0, 'Bo reads none of hers');
reset role;

select 'coach-workspaces: all assertions passed';
