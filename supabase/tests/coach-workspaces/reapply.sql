-- Applied again after a rollback: back on, nothing changed for JF Effect.
\set ON_ERROR_STOP 1
select t_assert((select count(*) from tenant_fence_report() where status = 'fenced') = 16, 'all 16 client tables fenced again');
select t_assert(not exists (select 1 from tenant_fence_report() where status in ('unfenced', 'rls_off')), 'nothing unfenced');
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1');
select t_assert(tenant_fence_mode() = 'hide', 'businesses still exist (empty), so JF Effect reads in hide mode');
select t_count_all('jared', 'again');
reset role;
select t_assert(not exists (
  select 1 from t_seen b join t_seen a on a.who = b.who and a.tbl = b.tbl and a.phase = 'again'
   where b.phase = 'before' and a.n <> b.n), 'and Jared sees exactly what he did before');
select 'coach-workspaces: re-applied cleanly';
