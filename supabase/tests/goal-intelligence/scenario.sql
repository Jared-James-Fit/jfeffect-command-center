-- The goal ledger: backfill, both-way sync, one open goal per identity, the
-- version, the append-only history, who reads what, and goal_intel_due().
\set ON_ERROR_STOP 1

do $$
declare
  sam constant uuid := '00000000-0000-0000-0000-0000000000c1';
  lee constant uuid := '00000000-0000-0000-0000-0000000000c2';
  ana constant uuid := '00000000-0000-0000-0000-00000000a0a1';
  sam_login constant uuid := '00000000-0000-0000-0000-00000000c0c1';
  winter constant uuid := '00000000-0000-0000-0000-00000000cc01';
  spring constant uuid := '00000000-0000-0000-0000-00000000cc02';
  g public.client_goals;
  n int;
  v int;
begin
  -- 1. backfill: what was on file is the ledger's first rows, once
  select count(*) into n from client_goals where client_id = sam;
  assert n = 3, format('backfill made %s goals, expected 3', n);
  select * into g from client_goals where client_id = sam and kind = 'bodyweight';
  assert g.status = 'active' and g.approved_kg = 65 and g.direction = 'down' and g.source_kind = 'profile', 'bodyweight goal backfilled as approved';
  select * into g from client_goals where client_id = sam and kind = 'event';
  assert g.dedupe_key = 'event:long_term' and g.deadline = '2027-03-06' and g.approved_text = 'Qualify for nationals', 'long-term goal backfilled';
  select * into g from client_goals where client_id = sam and kind = 'total';
  assert g.competition_id = spring and g.approved_kg = 300 and g.status = 'active', 'competition target backfilled';
  assert (select count(*) from client_goal_events where client_id = sam and action = 'created') = 3, 'one history row per backfilled goal';
  raise notice 'ok: backfill';

  -- 2. forward: an approved total at a meet sets the competition's targets, no echo back
  perform t_as_service();
  insert into client_goals (client_id, kind, title, direction, competition_id, event_title, deadline, status, approved_value, approved_unit, approved_kg, client_value, client_unit, client_kg, dedupe_key)
  values (sam, 'total', 'Total · Winter Open', 'up', winter, 'Winter Open', '2026-12-05', 'active', 287.5, 'kg', 287.5, 280, 'kg', 280, 'total:comp:' || winter)
  returning * into g;
  assert (select target_total_kg from competitions where id = winter) = 287.5, 'approved total written to the competition';
  assert (select athlete_goal_total_kg from competitions where id = winter) = 280, 'their own total written to the competition';
  select count(*) into n from client_goals where competition_id = winter;
  assert n = 1, 'the competition write did not echo a second goal';
  raise notice 'ok: forward sync to competitions';

  -- 3. one open goal per identity
  begin
    insert into client_goals (client_id, kind, title, status, dedupe_key) values (sam, 'total', 'Total again', 'proposed', 'total:comp:' || winter);
    assert false, 'a second open goal with the same identity was allowed';
  exception when unique_violation then null;
  end;
  raise notice 'ok: one open goal per identity';

  -- 4. back: the coach sets the target on the competition → the ledger follows, as a new version
  v := g.version;
  perform t_as(ana);
  update competitions set target_total_kg = 290 where id = winter;
  select * into g from client_goals where id = g.id;
  assert g.approved_kg = 290 and g.approved_by = ana, 'the competition''s target came back to the ledger';
  assert g.version = v + 1, 'a changed target is a new version';
  assert exists (select 1 from client_goal_events where goal_id = g.id and action = 'synced'), 'the sync is in the history';
  raise notice 'ok: reverse sync from competitions';

  -- 5. the meet's date and name follow; a cancelled meet closes its goals
  update competitions set meet_date = '2026-12-06', name = 'Winter Open II' where id = winter;
  select * into g from client_goals where id = g.id;
  assert g.deadline = '2026-12-06' and g.event_title = 'Winter Open II', 'date and name followed the competition';
  update competitions set status = 'cancelled' where id = winter;
  assert (select status from client_goals where id = g.id) = 'archived', 'a cancelled meet closes its goals';
  raise notice 'ok: competition date, name and cancellation';

  -- 6. the client sets their own bodyweight goal: their words, not an approval
  update client_goals set status = 'archived' where client_id = lee;
  perform t_as(sam_login);
  update clients set bodyweight_goal_value = 63, bodyweight_goal_unit = 'kg', bodyweight_goal_type = 'lose' where id = sam;
  select * into g from client_goals where client_id = sam and kind = 'bodyweight' and status in ('proposed', 'active');
  assert g.client_kg = 63 and g.client_unit_source = 'stated' and g.approved_kg = 65, 'the client''s change is their target, the approved one stays';
  -- the coach sets it: approved
  perform t_as(ana);
  update clients set bodyweight_goal_value = 140, bodyweight_goal_unit = 'lb', bodyweight_goal_date = '2027-02-01' where id = sam;
  select * into g from client_goals where id = g.id;
  assert g.status = 'active' and g.approved_value = 140 and g.approved_unit = 'lb' and abs(g.approved_kg - 63.503) < 0.01 and g.deadline = '2027-02-01', 'the coach''s change is the approved target';
  assert g.dedupe_key = 'bodyweight:date:2027-02-01', 'the identity follows the date';
  raise notice 'ok: bodyweight goal from the profile, client vs coach';

  -- 7. forward: an approved bodyweight goal writes the profile; dismissing it clears what it wrote
  perform t_as_service();
  update client_goals set approved_value = 61, approved_unit = 'kg', approved_kg = 61 where id = g.id;
  assert (select bodyweight_goal_value from clients where id = sam) = 61 and (select bodyweight_goal_unit from clients where id = sam) = 'kg', 'approved bodyweight goal written to the profile';
  select count(*) into n from client_goals where client_id = sam and kind = 'bodyweight' and status in ('proposed', 'active');
  assert n = 1, 'no echo from the profile write';
  update client_goals set status = 'dismissed' where id = g.id;
  assert (select bodyweight_goal_value from clients where id = sam) is null, 'dismissed: the profile''s goal it wrote is cleared';
  raise notice 'ok: forward sync to the bodyweight goal';

  -- 8. the long-term goal both ways
  perform t_as(ana);
  update program_intel_profiles set long_term_goal = '{"text": "Qualify for worlds", "date": "2027-06-01"}' where client_id = sam;
  select * into g from client_goals where client_id = sam and dedupe_key = 'event:long_term' and status = 'active';
  assert g.approved_text = 'Qualify for worlds' and g.deadline = '2027-06-01', 'the long-term goal came to the ledger';
  perform t_as_service();
  update client_goals set approved_text = 'Podium at worlds', deadline = '2027-06-02' where id = g.id;
  assert (select long_term_goal ->> 'text' from program_intel_profiles where client_id = sam) = 'Podium at worlds', 'the event goal wrote the long-term goal';
  assert (select long_term_goal ->> 'goalId' from program_intel_profiles where client_id = sam) = g.id::text, 'tied to its goal';
  raise notice 'ok: long-term goal both ways';

  -- 9. the history is append-only
  begin
    update client_goal_events set action = 'x' where client_id = sam;
    assert false, 'history was edited';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    delete from client_goal_events where client_id = sam;
    assert false, 'history was deleted';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  raise notice 'ok: append-only history';

  -- 10. the worker is called only when there's work
  update client_goals set assessed_at = now() where status in ('proposed', 'active');
  insert into app_settings (key, value) values ('goal_intel_scan', jsonb_build_object('messages_at', now())::text) on conflict (key) do update set value = excluded.value;
  assert not public.goal_intel_due(), 'nothing waiting: not due';
  insert into client_update_outbox (client_id, body, send_after) values (sam, 'hi', now() - interval '1 minute');
  assert public.goal_intel_due(), 'an update whose window is up is due';
  delete from client_update_outbox;
  insert into coaching_sessions (client_id, analysis_status) values (sam, 'ready');
  assert public.goal_intel_due(), 'a read meeting not scanned yet is due';
  insert into client_goal_sources (source_kind, source_id, client_id) select 'meeting', id::text, client_id from coaching_sessions;
  assert not public.goal_intel_due(), 'scanned: not due';
  raise notice 'ok: goal_intel_due';

  -- 11. one waiting update per client
  insert into client_update_outbox (client_id, body, send_after) values (sam, 'one', now());
  begin
    insert into client_update_outbox (client_id, body, send_after) values (sam, 'two', now());
    assert false, 'two waiting updates for one client';
  exception when unique_violation then null;
  end;
  raise notice 'ok: one waiting update per client';
end $$;

-- 12. who reads what: the client's coach and the admin, never another coach or the client; nobody writes
select t_as('00000000-0000-0000-0000-00000000a0a1');
set role authenticated;
do $$ begin
  assert (select count(*) from client_goals) > 0, 'their coach reads their goals';
  assert (select count(*) from client_update_outbox) = 1, 'their coach reads the waiting update';
  begin
    insert into client_goals (client_id, kind, title, dedupe_key) values ('00000000-0000-0000-0000-0000000000c1', 'physique', 'x', 'physique:x');
    assert false, 'a coach inserted a goal directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select t_as('00000000-0000-0000-0000-00000000b0b1');
set role authenticated;
do $$ begin
  assert (select count(*) from client_goals) = 0, 'another coach reads nothing';
  assert (select count(*) from client_goal_events) = 0, 'another coach reads no history';
end $$;
reset role;
select t_as('00000000-0000-0000-0000-00000000c0c1');
set role authenticated;
do $$ begin
  assert (select count(*) from client_goals) = 0, 'the client reads nothing (they get messages)';
  assert (select count(*) from client_update_outbox) = 0, 'the client reads no waiting update';
end $$;
reset role;
select t_as('00000000-0000-0000-0000-0000000000ad');
set role authenticated;
do $$ begin
  assert (select count(*) from client_goals) > 0, 'the admin reads every goal';
end $$;
reset role;
select t_as_service();

-- 13. deleting a client (an account purge) takes their history with them
do $$ begin
  delete from competitions where client_id = '00000000-0000-0000-0000-0000000000c2';
  delete from clients where id = '00000000-0000-0000-0000-0000000000c2';
  assert not exists (select 1 from client_goal_events where client_id = '00000000-0000-0000-0000-0000000000c2'), 'purged with the client';
  raise notice 'ok: purge';
end $$;

select 'goal-intelligence: all assertions passed';
