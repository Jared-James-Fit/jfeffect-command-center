\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- Ids from schema.sql
\set owner  '''00000000-0000-0000-0000-0000000000a1'''
\set ana    '''00000000-0000-0000-0000-0000000000c1'''
\set ben    '''00000000-0000-0000-0000-0000000000c2'''
\set fin    '''00000000-0000-0000-0000-0000000000f1'''
\set member '''00000000-0000-0000-0000-0000000000e1'''
\set ana_coach '''00000000-0000-0000-0000-00000000c0a1'''
\set ben_coach '''00000000-0000-0000-0000-00000000c0b2'''
\set marc   '''00000000-0000-0000-0000-0000000c1e01'''
\set nico   '''00000000-0000-0000-0000-0000000c1e02'''
\set p_marc '''00000000-0000-0000-0000-00000000b001'''
\set p_nico '''00000000-0000-0000-0000-00000000b002'''

-- ── The backfills ───────────────────────────────────────────────────────────
select t_assert((select count(*) = 1 from organizations where kind = 'jf_effect'), 'one JF Effect organization');
select t_assert((select owner_user_id = :owner from organizations where id = jf_org_id()), 'JF Effect is owned by the business owner');
select t_assert((select role = 'owner' and status = 'active' from organization_members where user_id = :owner), 'the owner is the owner');
select t_assert((select role = 'coach' and status = 'active' from organization_members where user_id = :ana), 'an active coach is a coach member');
select t_assert((select role = 'finance' and status = 'active' from organization_members where user_id = :fin), 'the finance login is a finance member');
select t_assert(not exists (select 1 from organization_members where user_id = :member), 'a JF member is not on the team');

-- Ben was suspended but still held the coach role: the hardening backfill took it away.
select t_assert(not has_role(:ben, 'coach'), 'a suspended coach no longer has the coach role');
select t_assert((select status = 'revoked' from organization_members where user_id = :ben), 'and is no longer an active team member');
select t_assert(exists (select 1 from organization_audit_log where action = 'coach.access_removed' and target_id = :ben_coach and detail ->> 'backfill' = 'true'), 'the backfill is in the access record');
select t_assert(exists (select 1 from organization_audit_log where action = 'member.revoked' and target_id = :ben), 'so is the membership change');

-- ── A coach's access follows their record ───────────────────────────────────
select t_as(:owner);
update coaches set status = 'Suspended' where id = :ana_coach;
select t_assert(not has_role(:ana, 'coach'), 'suspending a coach takes the role away at once');
select t_assert((select status = 'revoked' from organization_members where user_id = :ana), 'suspended: membership revoked');
select t_assert((select actor_user_id = :owner from organization_audit_log where action = 'coach.access_removed' and target_id = :ana_coach order by created_at desc limit 1), 'the record names who did it');

update coaches set status = 'Active' where id = :ana_coach;
select t_assert(has_role(:ana, 'coach'), 'setting a coach Active gives the role back');
select t_assert((select status = 'active' and role = 'coach' from organization_members where user_id = :ana), 'membership restored');
select t_assert(exists (select 1 from organization_audit_log where action = 'member.restored' and target_id = :ana), 'restoring is recorded');

update coaches set archived = true where id = :ana_coach;
select t_assert(not has_role(:ana, 'coach'), 'archiving an Active coach takes the role away too');
update coaches set archived = false where id = :ana_coach;
select t_assert(has_role(:ana, 'coach'), 'unarchiving an Active coach gives it back');

-- A new coach record that's only a pending invite never strips a role someone already has.
insert into auth.users values ('00000000-0000-0000-0000-0000000000d1', 'dual@example.test');
insert into user_roles values ('00000000-0000-0000-0000-0000000000d1', 'coach');
insert into coaches (user_id, full_name, email, status) values ('00000000-0000-0000-0000-0000000000d1', 'Dual', 'dual@example.test', 'Pending Invite');
select t_assert(has_role('00000000-0000-0000-0000-0000000000d1', 'coach'), 'inserting a pending record leaves an existing role alone');

-- ── Client assignments are recorded ─────────────────────────────────────────
update clients set assigned_coach_id = :ana_coach where id = :nico;
select t_assert(exists (select 1 from organization_audit_log where action = 'client.assigned' and target_id = :nico and summary like 'Nico Client is now coached by Ana Coach%'), 'assigning a client is recorded');
update clients set assigned_coach_id = null where id = :nico;
select t_assert(exists (select 1 from organization_audit_log where action = 'client.unassigned' and target_id = :nico), 'unassigning is recorded');
update clients set full_name = 'Nico C' where id = :nico;
select t_assert((select count(*) = 2 from organization_audit_log where target_id = :nico), 'other changes to a client add nothing');

-- ── The record is append-only ───────────────────────────────────────────────
do $$ begin
  update organization_audit_log set summary = 'edited';
  raise exception 'ASSERT FAILED: the record was edited';
exception when insufficient_privilege then raise notice 'ok: the record can''t be edited';
end $$;
do $$ begin
  delete from organization_audit_log;
  raise exception 'ASSERT FAILED: the record was deleted';
exception when insufficient_privilege then raise notice 'ok: the record can''t be deleted';
end $$;

-- ── Who sees what (RLS) ─────────────────────────────────────────────────────
reset role; select t_as(:ana); set role authenticated;
select t_assert((select count(*) = 1 from organization_members), 'a coach sees only their own membership');
select t_assert((select count(*) = 0 from organization_audit_log), 'a coach can''t read the access record');
select t_assert((select count(*) = 1 from organizations), 'a coach sees their organization');
do $$ begin
  insert into organization_members (org_id, user_id, role) values (jf_org_id(), auth.uid(), 'owner');
  raise exception 'ASSERT FAILED: a coach made themselves an owner';
exception when insufficient_privilege then raise notice 'ok: nobody writes memberships directly';
end $$;

reset role; select t_as(:member); set role authenticated;
select t_assert((select count(*) = 0 from organization_members), 'a member sees no memberships');
select t_assert((select count(*) = 0 from organizations), 'a member sees no organization');

reset role; select t_as(:owner); set role authenticated;
select t_assert((select count(*) >= 4 from organization_members), 'the owner sees the whole team');
select t_assert((select count(*) > 5 from organization_audit_log), 'the owner reads the access record');
reset role;

-- ── Purchase term dates: the admin or the client's own coach ────────────────
reset role; select t_as(:ana); set role authenticated;
select t_assert((select term_end_date = '2027-01-01' from update_purchase_term_dates(:p_marc, '2026-11-01', '2027-01-01', 'test')), 'a coach changes their own client''s dates');
do $$ begin
  perform update_purchase_term_dates('00000000-0000-0000-0000-00000000b002', '2026-11-01', '2027-01-01', null);
  raise exception 'ASSERT FAILED: a coach changed another client''s dates';
exception when insufficient_privilege then raise notice 'ok: a coach can''t change another client''s dates';
end $$;

reset role; select t_as(:member); set role authenticated;
do $$ begin
  perform auto_calculate_purchase_term_dates('00000000-0000-0000-0000-00000000b002', current_date, 3, 'months');
  raise exception 'ASSERT FAILED: a member set dates on a purchase';
exception when insufficient_privilege then raise notice 'ok: a member can''t set purchase dates';
end $$;
do $$ begin
  perform auto_calculate_purchase_term_dates('00000000-0000-0000-0000-00000000b001', current_date, 3, 'months');
  raise exception 'ASSERT FAILED: a member read back a dated purchase';
exception when insufficient_privilege then raise notice 'ok: a member can''t read a purchase through it either';
end $$;

reset role; select t_as(:owner); set role authenticated;
select t_assert((select term_start_date = current_date from auto_calculate_purchase_term_dates(:p_nico, current_date, 3, 'months')), 'the admin sets dates on any purchase');
select t_assert((select jsonb_array_length(term_date_history) = 2 and (term_date_history -> 1 ->> 'reason') = 'second'
                   from update_purchase_term_dates(:p_marc, '2026-11-02', '2027-01-02', 'second')), 'history keeps changes in order');

reset role; select t_as_service();
select t_assert((select term_end_date = '2027-02-01' from update_purchase_term_dates(:p_nico, '2026-11-01', '2027-02-01', 'server')), 'the server (service role) can too');
reset role;

\echo 'organizations: all assertions passed'
