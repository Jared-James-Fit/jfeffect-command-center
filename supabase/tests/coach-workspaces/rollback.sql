-- The rollback refuses while another business's records exist, and once
-- they're gone it puts JF Effect back exactly as it was.
\set ON_ERROR_STOP 1
do $$ begin
  begin
    execute pg_read_file('/tmp/cw_rollback.sql');
    raise exception 'ASSERT FAILED: rolled back with businesses still holding records';
  exception when raise_exception then
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
    raise notice 'ok: the rollback refuses while a business still has client records';
  end;
end $$;
-- close both businesses the hard way (a test database), then roll back
delete from pl_exercise_rows where day_id in (select d.id from pl_days d join pl_weeks w on w.id = d.week_id join pl_blocks b on b.id = w.block_id join clients c on c.id = b.client_id where c.organization_id <> jf_org_id());
delete from pl_days where week_id in (select w.id from pl_weeks w join pl_blocks b on b.id = w.block_id join clients c on c.id = b.client_id where c.organization_id <> jf_org_id());
delete from pl_weeks where block_id in (select b.id from pl_blocks b join clients c on c.id = b.client_id where c.organization_id <> jf_org_id());
delete from pl_blocks where client_id in (select id from clients where organization_id <> jf_org_id());
delete from pl_row_results where client_id in (select id from clients where organization_id <> jf_org_id());
delete from community_posts where client_id in (select id from clients where organization_id <> jf_org_id());
delete from messages where client_id in (select id from clients where organization_id <> jf_org_id());
delete from progress_bodyweight where user_id in (select user_id from clients where organization_id <> jf_org_id());
delete from organization_clients;
delete from clients where organization_id <> jf_org_id();
\i /tmp/cw_rollback.sql
select t_assert(not exists (select 1 from pg_policies where policyname = 'tenant_fence'), 'no fence left anywhere');
select t_assert(not exists (select 1 from information_schema.columns where table_name = 'clients' and column_name = 'organization_id'), 'clients.organization_id is gone');
select t_assert(to_regclass('public.organization_clients') is null, 'the workspace tables are gone');
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1'); select t_count_all('jared', 'rolled');
select t_as('00000000-0000-0000-0000-0000000000c1'); select t_count_all('ana', 'rolled');
select t_as('00000000-0000-0000-0000-0000000000d1'); select t_count_all('marc', 'rolled');
select t_as('00000000-0000-0000-0000-0000000000e1'); select t_count_all('mia', 'rolled');
reset role;
select t_assert(not exists (
  select 1 from t_seen b join t_seen a on a.who = b.who and a.tbl = b.tbl and a.phase = 'rolled'
   where b.phase = 'before' and a.n <> b.n), 'after the rollback JF Effect''s people see exactly what they did before');
select 'coach-workspaces: rolled back cleanly';
