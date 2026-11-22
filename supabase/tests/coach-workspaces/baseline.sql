-- What JF Effect's people see before the migrations run.
\set ON_ERROR_STOP 1
set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000a1'); select t_count_all('jared', 'before');
select t_as('00000000-0000-0000-0000-0000000000c1'); select t_count_all('ana', 'before');
select t_as('00000000-0000-0000-0000-0000000000d1'); select t_count_all('marc', 'before');
select t_as('00000000-0000-0000-0000-0000000000e1'); select t_count_all('mia', 'before');
select t_as('00000000-0000-0000-0000-0000000000f1'); select t_count_all('olivia', 'before');
reset role;
select 'baseline: ' || count(*) || ' counts recorded' from t_seen;
