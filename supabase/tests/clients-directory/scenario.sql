\set ON_ERROR_STOP 1

-- Fixtures -------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000000c0', 'coach@example.com'),
  ('00000000-0000-0000-0000-0000000000f0', 'stranger@example.com');
insert into public.user_roles values
  ('00000000-0000-0000-0000-0000000000ad', 'admin'),
  ('00000000-0000-0000-0000-0000000000c0', 'coach');
insert into public.coaches (id, user_id, full_name)
values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c0', 'Coach Cat');

insert into public.coaching_agreement_versions (id, version, content_hash, content_json, effective_date) values
  ('20000000-0000-0000-0000-000000000001', '2.0',       repeat('a', 64), '{"v":"2.0"}',       '2026-10-06'),
  ('20000000-0000-0000-0000-000000000002', '1.0',       repeat('b', 64), '{"v":"1.0"}',       '2026-01-01'),
  ('20000000-0000-0000-0000-000000000003', '2.0-draft', repeat('c', 64), '{"v":"2.0-draft"}', '2026-10-05');

-- 12 clients, one per contract situation. Everyone with an app account is signed in and
-- has training days set, so the only things that differ are what each case is about.
create function pg_temp.cid(n int) returns uuid language sql immutable as $$
  select ('10000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;

insert into public.clients (id, user_id, full_name, email, account_status, last_signed_in_at, preferred_training_days, created_at)
select pg_temp.cid(n), case when has_app then gen_random_uuid() end, name, lower(replace(name, ' ', '.')) || '@example.com',
       case when has_app then 'Account Created' else 'Invite Sent' end,
       case when has_app then now() end,
       array['mon'], now() - interval '30 days'
from (values
  (1,  'Signed Sam',        true),
  (2,  'Never Nora',        true),
  (3,  'Resign Rae',        true),
  (4,  'Old Olly',          true),
  (5,  'Paper Pat',         true),
  (6,  'NoApp Nick',        false),
  (7,  'Signed NoApp',      false),
  (8,  'Exempt NoApp',      false),
  (9,  'Resign Done Dee',   true),
  (10, 'Draft Dan',         true),
  (11, 'Exempt Resign Ed',  true),
  (12, 'Latest Wins Lou',   true)
) as t(n, name, has_app);

create function pg_temp.sign(n int, version_id text, at timestamptz) returns void language plpgsql as $$
begin
  insert into public.coaching_agreement_signatures
    (version_id, client_id, client_name, typed_name, signature_method, intent_statement, signed_at)
  values (version_id::uuid, pg_temp.cid(n), 'x', 'Typed Name', 'typed', 'I agree', at);
end $$;

select pg_temp.sign(1,  '20000000-0000-0000-0000-000000000001', now() - interval '10 days');
select pg_temp.sign(3,  '20000000-0000-0000-0000-000000000001', now() - interval '10 days');
select pg_temp.sign(4,  '20000000-0000-0000-0000-000000000002', now() - interval '10 days');
select pg_temp.sign(7,  '20000000-0000-0000-0000-000000000001', now() - interval '10 days');
select pg_temp.sign(9,  '20000000-0000-0000-0000-000000000001', now() - interval '5 days');
select pg_temp.sign(10, '20000000-0000-0000-0000-000000000003', now() - interval '10 days');
select pg_temp.sign(12, '20000000-0000-0000-0000-000000000002', now() - interval '20 days');
select pg_temp.sign(12, '20000000-0000-0000-0000-000000000001', now() - interval '2 days');

insert into public.coaching_agreement_client_state (client_id, resign_requested_at, exempt_kind) values
  (pg_temp.cid(3),  now() - interval '1 day',  null),                 -- asked again after they signed
  (pg_temp.cid(5),  null,                      'offline_signed'),
  (pg_temp.cid(8),  null,                      'not_required'),
  (pg_temp.cid(9),  now() - interval '8 days', null),                 -- signed after being asked
  (pg_temp.cid(11), now() - interval '1 day',  'not_required');       -- exempt wins over a request

-- Other things a coach filters on: Sam is fully set up (block, nutrition, paid); Nora has
-- nutrition only; Olly and Lou are paid, which isolates their contract / program gaps.
insert into public.pl_blocks (client_id, name, start_date, end_date, status)
values (pg_temp.cid(1), 'Block 1', (now() at time zone 'utc')::date - 7, (now() at time zone 'utc')::date + 21, 'Active');
insert into public.nutrition_targets (client_id, start_date, end_date, status)
values (pg_temp.cid(1), (now() at time zone 'utc')::date - 7, null, 'Active'),
       (pg_temp.cid(2), (now() at time zone 'utc')::date - 7, null, 'Active');
insert into public.purchase_records (client_id, payment_status, service_status)
values (pg_temp.cid(1), 'Active Subscription', 'Active'),
       (pg_temp.cid(4), 'Active Subscription', 'Active'),
       (pg_temp.cid(12), 'Active Subscription', 'Active');

update public.clients set assigned_coach_id = '50000000-0000-0000-0000-000000000001' where id = pg_temp.cid(2);

create function pg_temp.as_user(u uuid) returns void language sql as $$ update public.auth_ctx set uid = u $$;
create function pg_temp.dir(p_flags text[] default null, p_status text default null, p_size int default 50)
returns jsonb language sql as $$
  select public.admin_clients_directory(p_status => p_status, p_sort => 'name', p_limit => p_size, p_flags => p_flags)
$$;
create function pg_temp.names(d jsonb) returns text[] language sql as $$
  select coalesce(array_agg(r ->> 'full_name' order by r ->> 'full_name'), '{}') from jsonb_array_elements(d -> 'rows') r $$;

-- Contract status: same answers as resolveAgreementState + rosterStatusOf in TypeScript ----
do $$
declare bad text;
begin
  select string_agg(t.n::text || ':' || coalesce(v.status, 'null') || '!=' || t.expected, ', ')
    into bad
    from (values
      (1, 'signed'), (2, 'never_signed'), (3, 'admin_request'), (4, 'new_version'),
      (5, 'exempt'), (6, 'no_account'), (7, 'signed'), (8, 'exempt'),
      (9, 'signed'), (10, 'new_version'), (11, 'exempt'), (12, 'signed')
    ) as t(n, expected)
    left join public.coaching_agreement_client_status v on v.client_id = pg_temp.cid(t.n)
   where v.status is distinct from t.expected;
  perform t_assert(bad is null, 'every contract situation resolves like the TypeScript rules' || coalesce(' (wrong: ' || bad || ')', ''));
  perform t_assert(public.coaching_agreement_resign_below_version() = '2.0', 'the re-sign threshold function returns 2.0');
  perform t_assert((select signed_version from public.coaching_agreement_client_status where client_id = pg_temp.cid(12)) = '2.0',
                   'the latest signature decides, not the first');
  perform t_assert((select count(*) from public.coaching_agreement_client_status) = 12, 'one status row per client');
end $$;

-- The directory, as an admin -----------------------------------------------------------------
do $$
declare d jsonb; r jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
  d := pg_temp.dir();
  perform t_assert((d ->> 'total')::int = 12 and (d -> 'counts' ->> 'all')::int = 12, 'no filters: all 12 clients');

  select x into r from jsonb_array_elements(d -> 'rows') x where x ->> 'full_name' = 'Old Olly';
  perform t_assert(r ->> 'coaching_agreement_status' = 'new_version', 'each row carries its contract status');
  perform t_assert((r ->> 'f_no_contract')::boolean, 'a client who must sign again counts as having no contract');
  perform t_assert(r ->> 'coaching_agreement_version' = '1.0', 'and says which version they last signed');
  perform t_assert(not (r ? 'flags'), 'the internal flags array is not in the payload');

  select x into r from jsonb_array_elements(d -> 'rows') x where x ->> 'full_name' = 'Signed Sam';
  perform t_assert(not (r ->> 'f_no_contract')::boolean and r ->> 'coaching_agreement_signed_at' is not null, 'a signed client has no contract flag and a signed date');
  select x into r from jsonb_array_elements(d -> 'rows') x where x ->> 'full_name' = 'Paper Pat';
  perform t_assert(not (r ->> 'f_no_contract')::boolean and r ->> 'coaching_agreement_exempt_kind' = 'offline_signed', 'paper / not-required clients have no contract flag');
end $$;

-- Filters -----------------------------------------------------------------------------------
do $$
declare d jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');

  d := pg_temp.dir(array['no_contract']);
  perform t_assert((d ->> 'total')::int = 5 and (d -> 'counts' ->> 'no_contract')::int = 5, 'no_contract: never, asked again, old version, no app account, malformed version');
  perform t_assert(pg_temp.names(d) = array['Draft Dan', 'Never Nora', 'NoApp Nick', 'Old Olly', 'Resign Rae'], 'no_contract lists exactly those five');

  d := pg_temp.dir(array['no_contract', 'no_nutrition']);
  perform t_assert(pg_temp.names(d) = array['Draft Dan', 'NoApp Nick', 'Old Olly', 'Resign Rae'], 'two filters narrow to clients matching BOTH (Nora has nutrition)');
  perform t_assert((d -> 'counts' ->> 'no_contract')::int = 5, 'counts ignore the filters themselves: still 5 with no_contract');

  d := pg_temp.dir(null, 'no_contract');
  perform t_assert((d ->> 'total')::int = 5, 'the older single p_status spelling still filters');
  d := pg_temp.dir(array['no_contract'], 'no_nutrition');
  perform t_assert((d ->> 'total')::int = 4, 'p_status and p_flags combine (both must match)');
  d := pg_temp.dir(array['no_contract', 'no_contract']);
  perform t_assert((d ->> 'total')::int = 5, 'a repeated filter is harmless');
  d := pg_temp.dir(array['all']);
  perform t_assert((d ->> 'total')::int = 12, '"all" means no filter');
  d := pg_temp.dir(array['not_a_filter']);
  perform t_assert((d ->> 'total')::int = 0 and (d -> 'counts' ->> 'all')::int = 12, 'an unknown filter matches nothing (never silently everything)');

  d := pg_temp.dir(array['needs_setup']);
  perform t_assert(pg_temp.names(d) = array['Exempt NoApp', 'NoApp Nick', 'Signed NoApp'], 'needs_setup still means "has not signed in yet"');

  d := pg_temp.dir(array['no_payment']);
  perform t_assert((d ->> 'total')::int = 9, 'no_payment: everyone without a paid purchase (Sam, Olly, Lou are paid)');
  d := pg_temp.dir(array['no_program']);
  perform t_assert((d ->> 'total')::int = 11, 'no_program: everyone except Sam, who has a running block');
  d := pg_temp.dir(array['no_nutrition']);
  perform t_assert((d ->> 'total')::int = 10, 'no_nutrition: everyone except Sam and Nora');
  d := pg_temp.dir(array['no_cardio']);
  perform t_assert((d ->> 'total')::int = 12, 'no_cardio: nobody has a cardio plan');
  d := pg_temp.dir(array['no_contract', 'no_payment', 'no_program', 'no_nutrition', 'no_cardio']);
  perform t_assert(pg_temp.names(d) = array['Draft Dan', 'NoApp Nick', 'Resign Rae'], 'five filters at once still resolve (Nora has nutrition, Olly is paid)');

  perform t_assert(d -> 'counts' ?& array['all','needs_setup','needs_review','program_ending','payment_issues','no_payment','payment_pending','new_clients','missed_workouts','inactive','no_contract','no_program','no_nutrition','no_cardio'],
                   'counts has one number per filter');
end $$;

-- Attention order -----------------------------------------------------------------------------
do $$
declare d jsonb; olly int; lou int;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
  d := public.admin_clients_directory(p_sort => 'attention', p_limit => 50);
  select (x ->> 'priority')::int into olly from jsonb_array_elements(d -> 'rows') x where x ->> 'full_name' = 'Old Olly';
  select (x ->> 'priority')::int into lou  from jsonb_array_elements(d -> 'rows') x where x ->> 'full_name' = 'Latest Wins Lou';
  perform t_assert(olly = 5, 'a paid client who must sign again ranks 5 (after no payment, before program gaps)');
  perform t_assert(lou = 6, 'a paid, signed client with no program ranks 6 (program gaps moved down one)');
end $$;

-- Who can see what ------------------------------------------------------------------------------
do $$
declare d jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c0');
  d := pg_temp.dir();
  perform t_assert((d ->> 'total')::int = 1 and pg_temp.names(d) = array['Never Nora'], 'a coach sees only their own client');
  perform t_assert((pg_temp.dir(array['no_contract']) ->> 'total')::int = 1, 'and can filter that client by contract status');

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f0');
  perform t_assert((pg_temp.dir() ->> 'total')::int = 0, 'someone who is neither admin nor coach sees nobody');

  perform pg_temp.as_user(null);
  begin
    perform pg_temp.dir();
    raise exception 'unauthenticated call succeeded';
  exception when others then
    perform t_assert(sqlerrm = 'not authenticated', 'no signed-in user: refused');
  end;
end $$;

-- Privileges and overloads --------------------------------------------------------------------
do $$
declare sig regprocedure;
begin
  perform t_assert(not has_table_privilege('authenticated', 'public.coaching_agreement_client_status', 'select'), 'signed-in users cannot read the status view directly');
  perform t_assert(not has_table_privilege('anon', 'public.coaching_agreement_client_status', 'select'), 'anonymous users cannot read the status view');
  perform t_assert(has_table_privilege('service_role', 'public.coaching_agreement_client_status', 'select'), 'the server can');
  perform t_assert((select coalesce(reloptions, '{}') @> array['security_invoker=true'] from pg_class where oid = 'public.coaching_agreement_client_status'::regclass), 'and the view runs with the caller''s rights, not its owner''s');

  select p.oid::regprocedure into sig from pg_proc p where p.proname = 'admin_clients_directory' and p.pronargs = 9;
  perform t_assert(sig is not null, 'the 9-argument directory exists');
  perform t_assert((select count(*) from pg_proc where proname = 'admin_clients_directory') = 1,
                   'and it is the only directory function (a second overload would be ambiguous to PostgREST)');
  perform t_assert(has_function_privilege('authenticated', sig, 'execute') and has_function_privilege('service_role', sig, 'execute'), 'signed-in users and the server can run it');
  perform t_assert(not has_function_privilege('anon', sig, 'execute'), 'anonymous users cannot');
end $$;
