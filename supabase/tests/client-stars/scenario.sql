-- Starred clients: each login's own list, only of clients it can see.
\set ON_ERROR_STOP 1
set role authenticated;

-- A coach stars their own client, and reads it back with the client's name.
select t_as('00000000-0000-0000-0000-0000000000c1');
insert into staff_client_stars (user_id, client_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000c1e01');
select t_assert((select count(*) from staff_client_stars) = 1, 'a coach stars their own client');
select t_assert((select c.full_name from staff_client_stars s join clients c on c.id = s.client_id) = 'Marc Client', 'and reads it back with the name');

-- Starring twice is one star (the app upserts / ignores the duplicate).
do $$ begin
  insert into staff_client_stars (user_id, client_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000c1e01');
  raise exception 'duplicate star allowed';
exception when unique_violation then perform t_assert(true, 'one star per client per login');
end $$;

-- A coach can't star another coach's client.
do $$ begin
  insert into staff_client_stars (user_id, client_id) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000c1e02');
  raise exception 'starred another coach''s client';
exception when insufficient_privilege then perform t_assert(true, 'never another coach''s client');
end $$;

-- Nobody writes a star in someone else's name.
do $$ begin
  insert into staff_client_stars (user_id, client_id) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000c1e02');
  raise exception 'starred for someone else';
exception when insufficient_privilege then perform t_assert(true, 'never in someone else''s name');
end $$;

-- A suspended coach can't star the client they used to coach.
select t_as('00000000-0000-0000-0000-0000000000c3');
do $$ begin
  insert into staff_client_stars (user_id, client_id) values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000c1e03');
  raise exception 'suspended coach starred';
exception when insufficient_privilege then perform t_assert(true, 'a suspended coach can''t star');
end $$;

-- A client can't star anyone, themselves included.
select t_as('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  insert into staff_client_stars (user_id, client_id) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000c1e01');
  raise exception 'client starred';
exception when insufficient_privilege then perform t_assert(true, 'a client can''t star');
end $$;
select t_assert((select count(*) from staff_client_stars) = 0, 'a client reads no stars');

-- An admin stars any client; another admin never sees them.
select t_as('00000000-0000-0000-0000-0000000000a1');
insert into staff_client_stars (user_id, client_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c1e01'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c1e02');
select t_assert((select count(*) from staff_client_stars) = 2, 'an admin stars any client');
select t_as('00000000-0000-0000-0000-0000000000a2');
select t_assert((select count(*) from staff_client_stars) = 0, 'a second admin never sees the owner''s stars');
select t_as('00000000-0000-0000-0000-0000000000c1');
select t_assert((select count(*) from staff_client_stars) = 1, 'a coach sees only their own');

-- Nobody removes someone else's star; their own goes.
select t_as('00000000-0000-0000-0000-0000000000a2');
delete from staff_client_stars where user_id = '00000000-0000-0000-0000-0000000000a1';
select t_as('00000000-0000-0000-0000-0000000000a1');
select t_assert((select count(*) from staff_client_stars) = 2, 'someone else''s delete removes nothing');
delete from staff_client_stars where client_id = '00000000-0000-0000-0000-0000000c1e02';
select t_assert((select count(*) from staff_client_stars) = 1, 'unstarring removes only that star');

-- A star can't be changed, only added or removed.
do $$ begin
  update staff_client_stars set client_id = '00000000-0000-0000-0000-0000000c1e02';
  raise exception 'star updated';
exception when insufficient_privilege then perform t_assert(true, 'no updates');
end $$;

-- Anonymous callers get nothing at all.
reset role;
set role anon;
do $$ begin
  perform count(*) from staff_client_stars;
  raise exception 'anon read stars';
exception when insufficient_privilege then perform t_assert(true, 'anonymous can''t read');
end $$;

-- A star goes with its client.
reset role;
delete from clients where id = '00000000-0000-0000-0000-0000000c1e01';
select t_assert((select count(*) from staff_client_stars) = 0, 'a star goes with its client');
