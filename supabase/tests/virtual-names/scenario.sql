-- The virtual account names migration on the state schema.sql set up (applied twice).
\set ON_ERROR_STOP 1

-- 1. Placeholders were corrected by the migration itself, keeping everything else.
do $$
declare
  r record;
  jon uuid := (select user_id from public.t_before where slug = 'jon.doe');
begin
  perform public.t_assert(not exists (select 1 from public.virtual_accounts v
                                       where public.virtual_name_placeholder(v.first_name, v.last_name) is not null),
                          'no virtual account has a placeholder name after the migration');
  perform public.t_assert((select count(*) from public.virtual_accounts) = 15, 'every account is still there');
  perform public.t_assert((select count(*) from public.virtual_accounts v join public.t_before b using (user_id)
                            where b.slug not in ('jon.doe', 'jane.doe.lifts', 'testuser3')
                              and (v.first_name, v.last_name) is distinct from (b.first_name, b.last_name)) = 0,
                          'natural names were never touched');
  select v.*, cp.username, u.email, p.full_name into r
    from public.virtual_accounts v join public.community_profiles cp using (user_id)
    join auth.users u on u.id = v.user_id join public.profiles p on p.id = v.user_id
   where v.user_id = jon;
  raise notice 'Jon Doe is now % % (@%, %)', r.first_name, r.last_name, r.username, r.email;
  perform public.t_assert(r.name_source = 'corrected', 'Jon Doe: marked corrected');
  perform public.t_assert(r.name_gender = 'm', 'Jon Doe: renamed as a man');
  perform public.t_assert(r.full_name = r.first_name || ' ' || r.last_name, 'Jon Doe: profile name follows');
  perform public.t_assert(r.username <> 'jon.doe' and r.slug <> 'jon.doe' and r.email = r.slug || '@virtual.jfeffect.invalid',
                          'Jon Doe: username, slug and address replaced');
  perform public.t_assert((select raw_user_meta_data->>'full_name' from auth.users where id = jon) = r.full_name, 'Jon Doe: login name follows');
  perform public.t_assert((select identity_data->>'email' from auth.identities where user_id = jon) = r.email, 'Jon Doe: identity follows');
  perform public.t_assert(exists (select 1 from public.community_reactions where user_id = jon), 'Jon Doe: his like is kept');
  perform public.t_assert(exists (select 1 from public.community_follows where followee_id = jon), 'Jon Doe: his follower is kept');
  perform public.t_assert((select count(*) from public.virtual_account_activity where user_id = jon and action in ('created', 'like')) = 2,
                          'Jon Doe: his history is kept');
  perform public.t_assert(exists (select 1 from public.virtual_account_activity where user_id = jon and action = 'renamed'
                                    and detail->'before'->>'first_name' = 'Jon' and detail->>'by' = 'automatic'),
                          'Jon Doe: the rename is in his activity with before and after');
  perform public.t_assert((select name_gender from public.virtual_accounts v join public.t_before b using (user_id) where b.slug = 'jane.doe.lifts') = 'f',
                          'Jane Doe: renamed as a woman');
  perform public.t_assert((select cp.username from public.community_profiles cp join public.t_before b using (user_id) where b.slug = 'testuser3') <> 'testuser3',
                          'Test User: username replaced');
  perform public.t_assert((select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b3') = 'John Doe',
                          'a real person who calls themselves John Doe is never touched');
end $$;

-- 2. Starters read their names from the pool; nothing reads as a problem.
select public.t_assert((select count(*) from public.virtual_accounts where name_source = 'starter') = 12, 'the twelve starters say so');
select public.t_assert((select name_gender from public.virtual_accounts where slug = 'maya.lifts') = 'f', 'Maya reads as a woman');
select public.t_assert((select name_gender from public.virtual_accounts where slug = 'jordan.newbie') = 'u', 'Jordan reads as either');
select public.t_assert((select name_origin from public.virtual_accounts where slug = 'priya.strong') = 'indian', 'Raman reads as Indian');
select public.t_assert((select name_origin from public.virtual_accounts where slug = 'maya.lifts') = 'igbo', 'Okafor reads as Igbo');

-- 3. The admin can read and use it; nobody else can.
select public.t_as('00000000-0000-0000-0000-0000000000b1');
do $$ begin
  begin perform public.admin_virtual_name_suggestions(3, null, null); raise exception 'member got suggestions';
  exception when sqlstate '42501' then perform public.t_assert(true, 'a member is refused suggestions'); end;
  begin perform public.admin_virtual_name_check('Ethan', 'Mitchell', null); raise exception 'member got a check';
  exception when sqlstate '42501' then perform public.t_assert(true, 'a member is refused the check'); end;
  begin perform public.admin_virtual_account_rename((select user_id from public.virtual_accounts limit 1), 'Ethan', 'Mitchell'); raise exception 'member renamed';
  exception when sqlstate '42501' then perform public.t_assert(true, 'a member is refused a rename'); end;
end $$;
select public.t_as('00000000-0000-0000-0000-0000000000a1');

-- 4. Hundreds of generated names: natural, varied, never a member's, never repeated.
create table public.t_gen as
  select b.batch, g.*
    from generate_series(1, 40) b(batch)
    cross join lateral jsonb_to_recordset(public.admin_virtual_name_suggestions(12 + 0 * b.batch, null, null))
      as g(first_name text, last_name text, gender text, origin text, username text);
do $$
declare n int := (select count(*) from public.t_gen);
begin
  raise notice 'generated % names in 40 batches', n;
  perform public.t_assert(n = 480, 'every batch of 12 filled');
  perform public.t_assert(not exists (select 1 from public.t_gen where public.virtual_name_placeholder(first_name, last_name) is not null), 'no placeholder');
  perform public.t_assert(not exists (select 1 from public.t_gen where public.virtual_name_problem(first_name, last_name, null) is not null),
                          'every one passes the admin checks');
  perform public.t_assert(not exists (select 1 from public.t_gen where left(public.virtual_name_fold(first_name), 1) = left(public.virtual_name_fold(last_name), 1)),
                          'no alliteration');
  perform public.t_assert(not exists (select 1 from public.t_gen where public.virtual_name_fold(first_name) in ('marc', 'jared', 'ashley', 'ash', 'devin', 'kevin', 'john')),
                          'never a real person''s first name');
  perform public.t_assert(not exists (select 1 from public.t_gen where public.virtual_name_fold(last_name) in ('mcintyre', 'asugui', 'santos', 'buth', 'wong', 'doe')),
                          'never a real person''s surname');
  perform public.t_assert(not exists (select 1 from public.t_gen g join public.virtual_accounts v
                                        on split_part(public.virtual_name_fold(v.first_name), ' ', 1) = split_part(public.virtual_name_fold(g.first_name), ' ', 1)
                                        or public.virtual_name_fold(v.last_name) = public.virtual_name_fold(g.last_name)),
                          'never a first name or surname another virtual account has');
  perform public.t_assert(not exists (select batch from public.t_gen group by batch
                                       having count(distinct public.virtual_name_fold(first_name)) < 12
                                           or count(distinct public.virtual_name_fold(last_name)) < 12
                                           or count(distinct username) < 12
                                           or count(distinct left(public.virtual_name_fold(first_name), 1) || left(public.virtual_name_fold(last_name), 1)) < 12),
                          'a batch never repeats a first name, surname, username or initials');
  perform public.t_assert(not exists (select batch from public.t_gen group by batch
                                       having count(*) filter (where gender = 'f') not between 4 and 8),
                          'a batch is balanced between women and men');
  perform public.t_assert((select count(distinct origin) from public.t_gen) >= 18, 'at least 18 origins come up');
  perform public.t_assert((select max(c)::numeric / n from (select count(*) c from public.t_gen group by origin) x) <= 0.25,
                          'no origin is more than a quarter');
  perform public.t_assert((select count(distinct public.virtual_name_fold(first_name)) from public.t_gen) >= 220, 'at least 220 different first names');
  perform public.t_assert(not exists (select 1 from public.t_gen where username !~ '^[a-z0-9._]{3,24}$' or username ~ '^[._]|[._]$|[._][._]'),
                          'every username is well formed');
  perform public.t_assert(not exists (select 1 from public.t_gen where first_name ~ '\s'), 'first names are one word');
  perform public.t_assert(not exists (select 1 from public.t_gen g where g.last_name = 'Singh' and g.gender = 'f')
                      and not exists (select 1 from public.t_gen g where g.last_name = 'Kaur' and g.gender = 'm'),
                          'Singh and Kaur follow the person''s gender');
end $$;
select string_agg(first_name || ' ' || last_name || ' (@' || username || ', ' || origin || ')', '; ' order by random()) as sample
  from (select * from public.t_gen order by random() limit 25) s;
select origin, count(*) from public.t_gen group by origin order by 2 desc;

-- 5. A gender asked for is a gender given.
select public.t_assert((select bool_and(g->>'gender' = 'f') from jsonb_array_elements(public.admin_virtual_name_suggestions(12, 'f', null)) g),
                       'asked for women, got women');
select public.t_assert((select bool_and(g->>'gender' = 'm') from jsonb_array_elements(public.admin_virtual_name_suggestions(12, 'm', null)) g),
                       'asked for men, got men');

-- 6. What an admin types is checked like a generated name.
select public.t_assert((public.admin_virtual_name_check('John', 'Doe', null))->>'problem' = 'That''s a placeholder name', 'John Doe is a placeholder');
select public.t_assert((public.admin_virtual_name_check('Lift', 'Bot', null))->>'problem' like '"Bot" reads like a bot%', 'Lift Bot reads like a bot');
select public.t_assert((public.admin_virtual_name_check('Coach', 'Ryan', null))->>'problem' like '"Coach" could be mistaken%', 'Coach Ryan could pass for staff');
select public.t_assert((public.admin_virtual_name_check('Kevin', 'Hart', null))->>'problem' = 'That''s a well-known person''s name', 'Kevin Hart is famous');
select public.t_assert((public.admin_virtual_name_check('Marc', 'Bennett', null))->>'problem' like 'A member goes by Marc%', 'Marc is a member''s shown name');
select public.t_assert((public.admin_virtual_name_check('Ash', 'Bennett', null))->>'problem' like 'A member goes by Ash%', 'a preferred name counts');
select public.t_assert((public.admin_virtual_name_check('Devin', 'Buth', null))->>'problem' = 'A member already has that name', 'a member''s full name');
select public.t_assert((public.admin_virtual_name_check('Maya', 'Bennett', null))->>'problem' like 'Another virtual account is already called Maya', 'two Mayas');
select public.t_assert((public.admin_virtual_name_check('Ethan', 'Okafor', null))->>'problem' like 'Another virtual account already has the surname%', 'two Okafors');
select public.t_assert((public.admin_virtual_name_check('Ethan', '', null))->>'problem' = 'Add a last name', 'a surname is needed');
select public.t_assert((public.admin_virtual_name_check('Mary Ann', 'Bennett', null))->>'problem' like 'Use one word%', 'one word first names');
select public.t_assert((public.admin_virtual_name_check('Ethan', 'Mitchell', null))->>'problem' is null, 'Ethan Mitchell is fine');
select public.t_assert((public.admin_virtual_name_check('Ethan', 'Mitchell', null))->>'username' ~ '^[a-z0-9._]{3,24}$', 'and gets a username');
select public.t_assert((public.admin_virtual_name_check('Maya', 'Okafor', (select user_id from public.virtual_accounts where slug = 'maya.lifts')))->>'problem' is null,
                       'an account''s own name isn''t taken from itself');

-- 7. Renaming by hand keeps the account; the guard refuses a placeholder from any writer.
do $$
declare
  theo uuid := (select user_id from public.virtual_accounts where slug = 'theo.trains');
  s jsonb;
begin
  s := public.admin_virtual_name_suggestions(1, 'm', theo) -> 0;
  perform public.admin_virtual_account_rename(theo, s->>'first_name', s->>'last_name', s->>'username', 'm', s->>'origin', 'generated');
  perform public.t_assert((select first_name from public.virtual_accounts where user_id = theo) = s->>'first_name', 'regenerated by an admin');
  perform public.t_assert((select name_source from public.virtual_accounts where user_id = theo) = 'generated', 'marked generated');
  perform public.t_assert((select username from public.community_profiles where user_id = theo) = s->>'username', 'username moved with it');
  perform public.t_assert((select slug from public.virtual_accounts where user_id = theo) = 'theo.trains', 'the slug stays (it''s the account''s key)');
  perform public.t_assert((select actor_user_id from public.virtual_account_activity where user_id = theo and action = 'renamed') = '00000000-0000-0000-0000-0000000000a1',
                          'the rename names the admin');
  perform public.admin_virtual_account_update(theo, '{"first_name":"Theo","last_name":"Larsen"}');
  perform public.t_assert((select first_name || ' ' || last_name from public.virtual_accounts where user_id = theo) = 'Theo Larsen', 'renamed back by hand');
  perform public.t_assert((select name_source from public.virtual_accounts where user_id = theo) = 'admin', 'marked as the admin''s');
  begin
    perform public.admin_virtual_account_update(theo, '{"first_name":"Test","last_name":"User"}');
    raise exception 'placeholder rename went through';
  exception when sqlstate '22023' then perform public.t_assert(true, 'a placeholder rename is refused');
  end;
  begin
    update public.virtual_accounts set first_name = 'Jane', last_name = 'Doe' where user_id = theo;
    raise exception 'guard let a placeholder through';
  exception when sqlstate '22023' then perform public.t_assert(true, 'the guard refuses a placeholder written directly');
  end;
  update public.virtual_accounts set active = false where user_id = theo;
  perform public.t_assert(true, 'other changes pass the guard');
end $$;

-- 8. A new account: refused with a placeholder, made with a generated name.
do $$
declare
  s jsonb := public.admin_virtual_name_suggestions(1, 'f', null) -> 0;
  v uuid;
begin
  begin
    perform public.admin_virtual_account_create('demo.user', 'Demo', 'User', '');
    raise exception 'placeholder account made';
  exception when sqlstate '22023' then perform public.t_assert(true, 'a new placeholder account is refused');
  end;
  v := public.admin_virtual_account_create(s->>'username', s->>'first_name', s->>'last_name', '', null, '{}', 'generated', 'f');
  perform public.t_assert((select name_source || name_gender from public.virtual_accounts where user_id = v) = 'generatedf', 'made with its generated name');
  perform public.t_assert((select avatar_path from public.community_profiles where user_id = v) is null, 'and no photo');
end $$;

-- 9. The like tick corrects any placeholder it finds, likes switched off or not.
alter table public.virtual_accounts disable trigger virtual_accounts_name_guard;
update public.virtual_accounts set first_name = 'Bot', last_name = '7' where slug = 'graham.masters';
alter table public.virtual_accounts enable trigger virtual_accounts_name_guard;
select public.virtual_accounts_tick();
select public.t_assert((select public.virtual_name_placeholder(first_name, last_name) from public.virtual_accounts where slug = 'graham.masters') is null,
                       'the tick renamed it');
select public.t_assert((select name_source from public.virtual_accounts where slug = 'graham.masters') = 'corrected', 'marked corrected');

-- 10. The admin list says how each name came about and what's wrong with it now.
select public.t_assert((select bool_and(a ? 'name_source' and a ? 'name_problem') from jsonb_array_elements(public.admin_virtual_accounts()) a),
                       'the list carries name_source and name_problem');
select public.t_assert((select count(*) from jsonb_array_elements(public.admin_virtual_accounts()) a where a->>'name_problem' is not null) = 0,
                       'nothing to fix');
insert into public.clients (first_name, last_name) values ('Priya', 'Gill');
select public.t_assert((select a->>'name_problem' from jsonb_array_elements(public.admin_virtual_accounts()) a where a->>'slug' = 'priya.strong') like 'A member goes by Priya%',
                       'a member who joins with the same first name is flagged, never renamed by itself');
select public.t_assert((select first_name from public.virtual_accounts where slug = 'priya.strong') = 'Priya', 'Priya keeps her name');
select 'virtual names scenario passed' as result;
