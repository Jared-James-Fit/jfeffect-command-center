-- The gradual start (20270602100000_virtual_likes_rollout.sql) on the state scenario.sql left.
\set ON_ERROR_STOP 1

-- A clock for Winnipeg's hour the tests control: the rollout only starts accounts in the daytime.
create table public.t_hour (h integer);
insert into public.t_hour values (14);
create or replace function public.instant_to_local(_t timestamptz, _zone text) returns timestamp language sql stable as $$
  select date_trunc('day', _t at time zone _zone) + make_interval(hours => (select h from public.t_hour)) $$;

-- Calls the rollout step up to n times (its start is by chance); returns who started, if anyone.
create function public.t_step(n integer) returns uuid language plpgsql as $$
declare v uuid;
begin
  for i in 1..n loop
    v := public.virtual_accounts_rollout_step();
    exit when v is not null;
  end loop;
  return v;
end $$;

do $$
declare
  owner uuid := '00000000-0000-0000-0000-0000000000a1';
  marc uuid := '00000000-0000-0000-0000-0000000000b1';
  first_one uuid := (select user_id from public.virtual_accounts where slug = 'hannah.reps');
  q uuid[];
  st jsonb;
  started uuid;
  r record;
  ok boolean;
  n_wait integer;
begin
  -- 1. The columns and settings are there, defaults off.
  perform public.t_assert((public.virtual_accounts_settings()->>'rollout_enabled')::boolean = false, 'gradual start is off by default');
  perform public.t_assert((public.virtual_accounts_settings()->>'rollout_gap_days')::int = 3, 'three days between starts by default');

  -- 2. Only an admin sets the queue.
  perform public.t_as(marc);
  begin
    perform public.admin_virtual_rollout_set(array[first_one]);
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  perform public.t_assert(ok, 'a member can''t set the queue');
  begin
    perform public.admin_virtual_rollout_state();
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  perform public.t_assert(ok, 'a member can''t read the rollout');

  -- 3. The owner starts one account by hand: stamped, out of the queue.
  perform public.t_as(owner);
  perform public.admin_virtual_settings_set('{"automation_enabled": true, "rollout_enabled": true, "rollout_gap_days": 3}');
  perform public.t_assert((public.virtual_accounts_settings()->>'rollout_enabled')::boolean, 'gradual start switched on');
  perform public.admin_virtual_account_update(first_one, '{"likes_enabled": true}');
  select * into r from public.virtual_accounts where user_id = first_one;
  perform public.t_assert(r.likes_enabled and r.likes_started_at > now() - interval '1 minute' and r.rollout_position is null,
                          'switching likes on stamps when it started');

  -- 4. Queue every other account; one already liking is never queued, even when listed.
  q := array(select user_id from public.virtual_accounts order by created_at, slug);
  n_wait := (select count(*) from public.virtual_accounts where active and not likes_enabled);
  perform public.t_assert(n_wait >= 10, 'plenty waiting to start');
  perform public.admin_virtual_rollout_set(q);
  perform public.t_assert((select rollout_position from public.virtual_accounts where user_id = first_one) is null,
                          'an account already liking is never queued');
  perform public.t_assert((select count(*) from public.virtual_accounts where rollout_position is not null) = n_wait, 'every other active account is queued');
  perform public.t_assert(not exists (select 1 from public.virtual_accounts where not active and rollout_position is not null), 'an inactive account isn''t queued');
  perform public.t_assert((select array_agg(rollout_position order by rollout_position) from public.virtual_accounts where rollout_position is not null)
                            = array(select generate_series(1, n_wait)),
                          'positions run 1, 2, 3… in the order given, the liking one left out');
  perform public.t_assert((public.admin_virtual_accounts()->0->>'user_id')::uuid = first_one,
                          'the admin list puts the liking one first and carries the queue');

  -- 5. Not yet: the gap hasn't passed, and there's been no like since it started.
  st := public.admin_virtual_rollout_state();
  perform public.t_assert((st->>'enabled')::boolean and (st->>'needs_like')::boolean and (st->>'queued')::int = n_wait,
                          'rollout state: on, everyone else waiting, waiting for a like');
  perform public.t_assert(public.t_step(200) is null, 'nobody new starts before the gap passes');

  -- 6. The gap passes, but nobody's liked anything since: still waiting.
  update public.virtual_accounts set likes_started_at = now() - interval '4 days' where user_id = first_one;
  update public.virtual_account_activity set created_at = now() - interval '10 days' where action = 'like';  -- the fixtures' older likes
  perform public.t_assert(public.t_step(200) is null, 'nobody new starts until there''s been a like since the last start');

  -- 7. A like happens; at night nobody starts, in the day the next one does.
  insert into public.virtual_account_activity (user_id, action, post_id, detail, created_at)
  values (first_one, 'like', '00000000-0000-0000-0000-0000000000f1', '{"by":"automation"}', now() - interval '1 day');
  update public.t_hour set h = 23;
  perform public.t_assert(public.t_step(200) is null, 'nobody starts at 11 PM');
  update public.t_hour set h = 7;
  perform public.t_assert(public.t_step(200) is null, 'nobody starts at 7 AM');
  update public.t_hour set h = 14;
  st := public.virtual_rollout_state();
  started := public.t_step(400);
  perform public.t_assert(started = (st->>'next_user_id')::uuid, 'in the afternoon the first in the queue starts');
  select * into r from public.virtual_accounts where user_id = started;
  perform public.t_assert(r.likes_enabled and r.rollout_position is null and r.likes_started_at > now() - interval '1 minute',
                          'it''s liking now, out of the queue, stamped');
  perform public.t_assert(exists (select 1 from public.virtual_account_activity where user_id = started and action = 'rollout_started'),
                          'the start is in its activity');
  perform public.t_assert((select count(*) from public.virtual_accounts where likes_enabled) = 2, 'only one started');
  perform public.t_assert((select count(*) from public.virtual_accounts where rollout_position is not null) = n_wait - 1, 'one fewer waiting');

  -- 8. Right after a start, nobody else starts (the gap starts again).
  perform public.t_assert(public.t_step(400) is null, 'the next one waits for its own gap');

  -- 9. The global switch off stops the gradual start too.
  update public.virtual_accounts set likes_started_at = now() - interval '10 days' where likes_enabled;
  perform public.admin_virtual_settings_set('{"automation_enabled": false}');
  perform public.t_assert(public.t_step(200) is null, 'with the global switch off nobody starts');
  perform public.t_assert(public.virtual_accounts_tick() = 0, 'and the tick likes nothing');
  perform public.admin_virtual_settings_set('{"automation_enabled": true, "rollout_enabled": false}');
  perform public.t_assert(public.t_step(200) is null, 'with the gradual start off nobody starts');

  -- 10. Reorder and remove: the queue is exactly what the admin says.
  q := array(select user_id from public.virtual_accounts where rollout_position is not null order by rollout_position desc);
  perform public.admin_virtual_rollout_set(q[1:3]);
  perform public.t_assert((select count(*) from public.virtual_accounts where rollout_position is not null) = 3, 'taken out of the queue');
  perform public.t_assert((select user_id from public.virtual_accounts where rollout_position = 1) = q[1], 'reordered');

  -- 11. Switching a queued account on by hand starts it now and takes it out of the queue.
  perform public.admin_virtual_account_update(q[2], '{"likes_enabled": true}');
  perform public.t_assert((select rollout_position is null and likes_enabled from public.virtual_accounts where user_id = q[2]),
                          'starting a queued account by hand takes it out of the queue');

  -- 12. The tick still runs, never likes a virtual account's post, and logs what it likes.
  perform public.t_as(null);
  insert into public.community_posts (id, author_user_id, created_at) values
    ('00000000-0000-0000-0000-0000000000f2', marc, now() - interval '2 hours'),
    ('00000000-0000-0000-0000-0000000000f3', first_one, now() - interval '2 hours');
  update public.virtual_accounts set daily_like_limit = 20, quiet_start = 0, quiet_end = 0 where likes_enabled;
  for i in 1..60 loop
    delete from public.virtual_account_activity where action = 'like' and created_at > now() - interval '1 hour';
    perform public.virtual_accounts_tick();
  end loop;
  perform public.t_assert(not exists (select 1 from public.community_reactions where post_id = '00000000-0000-0000-0000-0000000000f3'),
                          'never a virtual account''s own post');
  perform public.t_assert(exists (select 1 from public.community_reactions cr join public.virtual_accounts v on v.user_id = cr.user_id
                                    where cr.post_id = '00000000-0000-0000-0000-0000000000f2'),
                          'a fresh member post gets liked');
  perform public.t_assert((select count(*) from public.community_reactions cr join public.virtual_accounts v on v.user_id = cr.user_id
                            where cr.post_id = '00000000-0000-0000-0000-0000000000f2') <= 2,
                          'never more virtual likes than a post may get');
end $$;

-- 13. Fresh posts first: the draw the tick uses picks a 1-hour-old post far more often than a 30-hour-old one.
do $$
declare fresh int := 0; old int := 0; pick text;
begin
  for i in 1..2000 loop
    select x.k into pick from (values ('fresh', now() - interval '1 hour'), ('old', now() - interval '30 hours')) x(k, created_at)
     order by -ln(1.0 - random()) / exp(-extract(epoch from now() - x.created_at) / 41544.0) limit 1;
    if pick = 'fresh' then fresh := fresh + 1; else old := old + 1; end if;
  end loop;
  raise notice 'fresh % / old %', fresh, old;
  perform public.t_assert(fresh > old * 8, 'a fresh post is much likelier than a day-old one');
end $$;
