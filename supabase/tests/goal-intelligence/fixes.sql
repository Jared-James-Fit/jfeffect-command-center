-- The review of Nov 26 2026 (20270602130000_goal_intelligence_fixes.sql): each
-- fix in the sync, the outbox and the worker's queries, as a case that must
-- stay fixed.
\set ON_ERROR_STOP 1

do $$
declare
  kai constant uuid := '00000000-0000-0000-0000-0000000000c3';
  kai_login constant uuid := '00000000-0000-0000-0000-00000000c0c3';
  mem constant uuid := '00000000-0000-0000-0000-0000000000c4';
  mem_login constant uuid := '00000000-0000-0000-0000-00000000c0c4';
  ana constant uuid := '00000000-0000-0000-0000-00000000a0a1';
  meet constant uuid := '00000000-0000-0000-0000-00000000cc31';
  meet2 constant uuid := '00000000-0000-0000-0000-00000000cc32';
  g public.client_goals;
  g2 public.client_goals;
  c public.clients;
  set_at timestamptz;
  n int;
begin
  perform t_as_service();
  insert into clients (id, user_id, first_name, assigned_coach_id, preferred_weight_unit) values (kai, kai_login, 'Kai', '00000000-0000-0000-0000-0000000000a1', 'kg');
  insert into clients (id, user_id, first_name, service_tier) values (mem, mem_login, 'Mo', 'self_serve');

  -- 1. the coach's maintain range lands in the ledger with its type and range
  perform t_as(ana);
  update clients set bodyweight_goal_type = 'maintain', bodyweight_goal_value = 75, bodyweight_goal_value_max = 77, bodyweight_goal_unit = 'kg' where id = kai;
  select * into g from client_goals where client_id = kai and kind = 'bodyweight' and status = 'active';
  assert g.profile_type = 'maintain' and g.approved_value = 75 and g.approved_value_max = 77, 'maintain range kept on the goal';

  -- 2. a read (assessed_at, the feasibility) never rewrites the profile
  select bodyweight_goal_set_at into set_at from clients where id = kai;
  perform t_as_service();
  update client_goals set assessed_at = now(), feasibility = '{"score": 90}'::jsonb, data_hash = 'x' where id = g.id;
  select * into c from clients where id = kai;
  assert c.bodyweight_goal_type = 'maintain' and c.bodyweight_goal_value_max = 77 and c.bodyweight_goal_set_at is not distinct from set_at, 'a read left the maintain goal as it was';
  raise notice 'ok: the mirror writes only on a real change, keeping the profile''s type and range';

  -- 3. a new approved bodyweight goal replaces the old one: the profile never flips
  insert into client_goals (client_id, kind, title, direction, deadline, status, approved_value, approved_unit, approved_kg, dedupe_key)
  values (kai, 'bodyweight', 'Bodyweight by May 1, 2027', 'down', '2027-05-01', 'active', 72, 'kg', 72, 'bodyweight:date:2027-05-01')
  returning * into g2;
  assert (select status from client_goals where id = g.id) = 'archived', 'the old bodyweight goal is archived';
  select * into c from clients where id = kai;
  assert c.bodyweight_goal_value = 72 and c.bodyweight_goal_type = 'lose' and c.bodyweight_goal_value_max is null, 'the profile follows the one active goal';
  update client_goals set assessed_at = now() where client_id = kai;
  assert (select bodyweight_goal_value from clients where id = kai) = 72, 'still the one goal after a read';
  select count(*) into n from client_goals where client_id = kai and kind = 'bodyweight' and status = 'active';
  assert n = 1, 'one active bodyweight goal';
  raise notice 'ok: one bodyweight goal at a time';

  -- 4. a member's own goal never enters the ledger; a write with nobody signed in is never an approval
  update clients set bodyweight_goal_type = 'lose', bodyweight_goal_value = 60, bodyweight_goal_unit = 'kg' where id = mem;
  assert not exists (select 1 from client_goals where client_id = mem), 'a member''s goal stays theirs';
  update client_goals set status = 'archived' where client_id = kai and kind = 'bodyweight';
  update clients set bodyweight_goal_type = 'gain', bodyweight_goal_value = 80, bodyweight_goal_unit = null where id = kai;
  select * into g from client_goals where client_id = kai and kind = 'bodyweight' and status in ('proposed', 'active');
  assert g.status = 'proposed' and g.approved_value is null and g.client_value = 80, 'no signed-in coach: proposed, never approved';
  assert g.client_unit = 'kg', 'no unit on the profile reads as their own unit';
  raise notice 'ok: members and unsigned writes';

  -- 5. a target cleared on the competition stays cleared
  perform t_as(ana);
  insert into competitions (id, client_id, name, meet_date, target_total_kg, athlete_goal_total_kg) values (meet, kai, 'Provincials', '2027-03-01', 600, 620);
  select * into g from client_goals where dedupe_key = 'total:comp:' || meet and status in ('proposed', 'active');
  assert g.status = 'active' and g.approved_kg = 600 and g.client_kg = 620, 'target and their total in the ledger';
  update competitions set target_total_kg = null where id = meet;
  select * into g from client_goals where id = g.id;
  assert g.status = 'proposed' and g.approved_kg is null and g.client_kg = 620, 'cleared: un-approved, their number kept';
  perform t_as_service();
  update client_goals set assessed_at = now(), feasibility = '{}'::jsonb where id = g.id;
  assert (select target_total_kg from competitions where id = meet) is null, 'a cleared target never comes back';
  perform t_as(ana);
  update competitions set athlete_goal_total_kg = null where id = meet;
  assert (select status from client_goals where id = g.id) = 'archived', 'nothing left on it: closed';
  raise notice 'ok: a cleared competition target stays cleared';

  -- 6. a cancelled meet clears what its goals wrote, and back on reopens them
  insert into competitions (id, client_id, name, meet_date, target_total_kg) values (meet2, kai, 'Westerns', '2027-04-01', 300);
  select * into g from client_goals where dedupe_key = 'total:comp:' || meet2 and status = 'active';
  update competitions set status = 'cancelled' where id = meet2;
  assert (select status from client_goals where id = g.id) = 'archived', 'cancelled: archived';
  assert (select target_total_kg from competitions where id = meet2) is null, 'cancelled: what it wrote is cleared';
  update competitions set status = 'upcoming' where id = meet2;
  assert (select status from client_goals where id = g.id) = 'active', 'back on: reopened';
  assert (select target_total_kg from competitions where id = meet2) = 300, 'back on: written again';
  raise notice 'ok: cancel and back on';

  -- 7. the long-term goal isn't rewritten by a read
  perform t_as_service();
  select * into g from client_goals where client_id = '00000000-0000-0000-0000-0000000000c1' and dedupe_key = 'event:long_term' and status = 'active';
  update program_intel_profiles set long_term_goal = long_term_goal || '{"savedAt": "2026-01-01T00:00:00Z"}'::jsonb where client_id = '00000000-0000-0000-0000-0000000000c1';
  update client_goals set assessed_at = now(), feasibility = '{}'::jsonb where id = g.id;
  assert (select long_term_goal ->> 'savedAt' from program_intel_profiles where client_id = '00000000-0000-0000-0000-0000000000c1') = '2026-01-01T00:00:00Z', 'a read left the long-term goal alone';
  raise notice 'ok: long-term goal left alone by a read';

  -- 8. the outbox: a send in flight never blocks the next update, and a stuck one is due
  delete from client_update_outbox;
  insert into client_update_outbox (client_id, status, body, send_after, claimed_at) values (kai, 'sending', 'x', now(), now() - interval '20 minutes');
  insert into client_update_outbox (client_id, status, body, send_after) values (kai, 'pending', 'y', now() + interval '30 minutes');
  begin
    insert into client_update_outbox (client_id, status, body, send_after) values (kai, 'held', 'z', now());
    assert false, 'two waiting updates for one client';
  exception when unique_violation then null;
  end;
  insert into client_update_outbox (client_id, status, body, send_after, hold_reason) values ('00000000-0000-0000-0000-0000000000c1', 'held', 'h', now(), 'send_failed');
  update client_goals set assessed_at = now() where status in ('proposed', 'active');
  assert public.goal_intel_due(), 'a send stuck for 10 minutes is due';
  update client_update_outbox set claimed_at = now() where status = 'sending';
  raise notice 'ok: outbox';

  -- 9. the worker's queries return only what hasn't been read
  delete from coaching_sessions;
  insert into coaching_sessions (id, client_id, analysis_status, updated_at) values
    ('00000000-0000-0000-0000-00000000e001', kai, 'ready', now() - interval '3 days'),
    ('00000000-0000-0000-0000-00000000e002', kai, 'ready', now() - interval '1 day');
  insert into client_goal_sources (source_kind, source_id, client_id, scanned_at) values ('meeting', '00000000-0000-0000-0000-00000000e001', kai, now())
    on conflict (source_kind, source_id) do update set scanned_at = now();
  assert (select count(*) from public.goal_intel_meetings_to_scan(50)) = 1, 'only the meeting not read since it changed';
  assert (select id from public.goal_intel_meetings_to_scan(50)) = '00000000-0000-0000-0000-00000000e002', 'the right one';
  raise notice 'ok: the worker''s queries';

  -- 10. an account purge deletes the goal history (while the client row is still there)
  begin
    delete from client_goal_events where client_id = kai;
    assert false, 'history deleted without the purge setting';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  perform set_config('jf.allow_history_delete', 'on', true);
  delete from client_goal_events where client_id = kai;
  perform set_config('jf.allow_history_delete', '', true);
  assert not exists (select 1 from client_goal_events where client_id = kai), 'the purge took the history';
  raise notice 'ok: purge';
end $$;

select 'goal-intelligence fixes: all assertions passed';
