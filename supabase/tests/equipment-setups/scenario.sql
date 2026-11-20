\set ON_ERROR_STOP 1
set client_min_messages = notice;

create table t_ids (k text primary key, v uuid);
create function t_id(_k text) returns uuid language sql stable as $$ select v from t_ids where k = _k $$;

do $$
declare
  athlete uuid := gen_random_uuid();
  coach_user uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  admin_user uuid := gen_random_uuid();
  coach uuid; c uuid; c2 uuid;
  squat uuid; bench uuid; rowex uuid; squat_dupe uuid;
  day uuid := gen_random_uuid(); day2 uuid := gen_random_uuid();
  r_sq uuid; r_sq2 uuid; r_bp uuid; r_row uuid; r_old uuid;
  gold uuid; home uuid; empty_gym uuid;
  rack uuid; rack_home uuid; row_gold uuid; row_home uuid; thing uuid; trash_bench uuid; spare uuid; rack_home2 uuid;
  s jsonb; j jsonb; v text; n int;
  s_today uuid; s_old uuid; s_first uuid; s_draft uuid; s_explicit uuid; s_row uuid; s_bench uuid; s_past uuid;
begin
  insert into coaches(user_id) values (coach_user) returning id into coach;
  insert into clients(user_id, assigned_coach_id, full_name) values (athlete, coach, 'Marc') returning id into c;
  insert into clients(user_id, full_name) values (stranger, 'Someone else') returning id into c2;
  insert into user_roles values (admin_user, 'admin');
  insert into exercises(name) values ('Competition Squat') returning id into squat;
  insert into exercises(name) values ('Competition Bench Press') returning id into bench;
  insert into exercises(name) values ('Hammer Strength Row') returning id into rowex;
  insert into exercises(name) values ('Comp Squat (dupe)') returning id into squat_dupe;
  insert into pl_exercise_rows(day_id, exercise_id) values (day, squat) returning id into r_sq;
  insert into pl_exercise_rows(day_id, exercise_id) values (day, squat) returning id into r_sq2; -- the squat's back-offs
  insert into pl_exercise_rows(day_id, exercise_id) values (day, bench) returning id into r_bp;
  insert into pl_exercise_rows(day_id, exercise_id) values (day, rowex) returning id into r_row;
  insert into pl_exercise_rows(day_id, exercise_id) values (day2, squat) returning id into r_old;

  perform t_as(athlete);

  -- Nothing saved yet: a logged set has no equipment.
  insert into pl_row_results(row_id, client_id, set_index, completed_at) values (r_sq, c, 1, now()) returning id into s_first;
  perform t_assert((select equipment_id from pl_row_results where id = s_first) is null, 'no setups: set has no equipment');

  -- Gyms: a name they already have is the same gym.
  gold := (public.equipment_gym_save(c, 'Gold''s Gym')->>'id')::uuid;
  j := public.equipment_gym_save(c, '  gold''s GYM ');
  perform t_assert((j->>'id')::uuid = gold and (j->>'existed')::boolean, 'gym dedupe by name');
  home := (public.equipment_gym_save(c, 'Home')->>'id')::uuid;
  begin
    perform public.equipment_gym_save(c, 'Home', gold);
    raise exception 'renaming onto an existing name should fail';
  exception when unique_violation then perform t_assert(true, 'gym rename onto a taken name refused');
  end;
  begin
    perform public.equipment_gym_save(c, '   ');
    raise exception 'blank gym name should fail';
  exception when invalid_parameter_value then perform t_assert(true, 'blank gym name refused');
  end;

  -- Equipment: one per name per gym; the same name in another gym is another rack.
  rack := (public.equipment_save(c, 'Rogue rack', 'rack', gold)->>'id')::uuid;
  j := public.equipment_save(c, 'rogue RACK ', 'rack', gold);
  perform t_assert((j->>'id')::uuid = rack and (j->>'existed')::boolean, 'equipment dedupe by name in a gym');
  rack_home := (public.equipment_save(c, 'Rogue rack', 'rack', home)->>'id')::uuid;
  perform t_assert(rack_home <> rack, 'same name in another gym is its own');
  row_gold := (public.equipment_save(c, 'Hammer ISO row', 'machine', gold, 'Hammer Strength', 'ISO-Lateral Row')->>'id')::uuid;
  row_home := (public.equipment_save(c, 'Cable row', 'cable', home)->>'id')::uuid;
  thing := (public.equipment_save(c, 'Thing', 'spaceship')->>'id')::uuid;
  perform t_assert((select kind from athlete_equipment where id = thing) = 'other', 'unknown kind reads as other');
  perform t_assert((select brand || ' / ' || model from athlete_equipment where id = row_gold) = 'Hammer Strength / ISO-Lateral Row', 'brand and model kept');
  begin
    perform public.equipment_save(c, 'Rack', 'rack', null, null, null, null, c2::text || '/x.jpg');
    raise exception 'a photo in someone else''s folder should fail';
  exception when insufficient_privilege then perform t_assert(true, 'photo path must be the athlete''s folder');
  end;

  -- A setup: settings cleaned; the exercise's first setup is current.
  s := public.equipment_setup_save(c, squat, rack,
    '[{"label":" J-hooks ","value":" 9 "},{"label":"Safeties","value":""},{"label":"","value":"x"},5,{"label":"Safeties","value":"4"}]'::jsonb,
    'Feet under the bar', null, false);
  perform t_assert(s->'settings' = '[{"label":"J-hooks","value":"9"},{"label":"Safeties","value":"4"}]'::jsonb, 'settings cleaned: blanks and junk dropped, order kept');
  perform t_assert(s->>'source' = 'athlete', 'athlete wrote it');
  perform t_assert(public.athlete_current_equipment(c, squat) = rack, 'first setup is current');
  perform t_assert(public.athlete_setup_clean_settings((select jsonb_agg(jsonb_build_object('label', 'L' || i, 'value', 'v')) from generate_series(1, 20) i)) ->> 11 is not null
    and public.athlete_setup_clean_settings((select jsonb_agg(jsonb_build_object('label', 'L' || i, 'value', 'v')) from generate_series(1, 20) i)) ->> 12 is null, 'at most 12 settings');

  -- Stamping: a set logged now takes the current equipment; an old one doesn't; a writer's choice wins.
  insert into pl_row_results(row_id, client_id, set_index, completed_at) values (r_sq, c, 2, now()) returning id into s_today;
  perform t_assert((select equipment_id from pl_row_results where id = s_today) = rack, 'set logged now is stamped');
  insert into pl_row_results(row_id, client_id, set_index, completed_at) values (r_old, c, 1, now() - interval '3 days') returning id into s_old;
  perform t_assert((select equipment_id from pl_row_results where id = s_old) is null, 'a set logged days ago is never stamped');
  update pl_row_results set actual_reps = 5 where id = s_first;
  perform t_assert((select equipment_id from pl_row_results where id = s_first) is null, 'editing an already-logged set never stamps it');
  insert into pl_row_results(row_id, client_id, set_index, completed_at) values (r_sq, c, 3, null) returning id into s_draft;
  perform t_assert((select equipment_id from pl_row_results where id = s_draft) is null, 'a draft is not stamped');
  update pl_row_results set completed_at = now() where id = s_draft;
  perform t_assert((select equipment_id from pl_row_results where id = s_draft) = rack, 'logging a draft stamps it');
  insert into pl_row_results(row_id, client_id, set_index, completed_at, equipment_id) values (r_sq, c, 4, now(), rack_home) returning id into s_explicit;
  perform t_assert((select equipment_id from pl_row_results where id = s_explicit) = rack_home, 'a writer that names equipment wins');

  -- Switching live: the exercise's sets logged today (both its cards) move; older sets don't.
  insert into pl_row_results(row_id, client_id, set_index, completed_at) values (r_sq2, c, 1, now()) returning id into s_row;
  j := public.equipment_choose(c, squat, rack_home, day);
  perform t_assert(public.athlete_current_equipment(c, squat) = rack_home, 'choose makes it current');
  perform t_assert((select count(*) from pl_row_results where row_id in (r_sq, r_sq2) and completed_at > now() - interval '1 hour' and equipment_id = rack_home) = 5, 'today''s sets on both squat cards moved');
  perform t_assert((select equipment_id from pl_row_results where id = s_first) = rack_home, 'an unstamped set from today is attributed too');
  perform t_assert((select equipment_id from pl_row_results where id = s_old) is null, 'a past workout''s sets stay as they were');
  perform t_assert((select settings from athlete_exercise_setups where client_id = c and exercise_id = squat and equipment_id = rack_home) = '[]'::jsonb, 'a first pick makes an empty setup');
  perform t_assert((select last_used_at from athlete_equipment where id = rack_home) is not null, 'equipment remembers its last use');

  -- Gym inference: at Gold's today, the row moves to its Gold's setup.
  perform public.equipment_setup_save(c, rowex, row_gold, '[{"label":"Seat","value":"4"}]', null, null, true);
  perform public.equipment_setup_save(c, rowex, row_home, '[]', null, null, true);
  perform t_assert(public.athlete_current_equipment(c, rowex) = row_home, 'make_current switches the current setup');
  insert into pl_row_results(row_id, client_id, set_index, completed_at) values (r_row, c, 1, now()) returning id into s_row;
  perform t_assert((select equipment_id from pl_row_results where id = s_row) = row_home, 'row set stamped with home');
  j := public.equipment_choose(c, squat, rack, day);
  perform t_assert(j->'moved' @> jsonb_build_array(jsonb_build_object('exercise_id', rowex, 'equipment_id', row_gold)), 'row moved to its Gold''s setup');
  perform t_assert(public.athlete_current_equipment(c, rowex) = row_gold, 'row current is Gold''s');
  perform t_assert((select equipment_id from pl_row_results where id = s_row) = row_gold, 'row set today moved with it');
  perform t_assert(jsonb_array_length(j->'moved') = 1, 'bench (no setup) left alone');

  -- Nothing in particular: the bench's sets aren't stamped.
  perform public.equipment_choose(c, bench, null, day);
  perform t_assert(public.athlete_current_equipment(c, bench) is null, 'generic pick: no current equipment');
  insert into pl_row_results(row_id, client_id, set_index, completed_at) values (r_bp, c, 1, now()) returning id into s_bench;
  perform t_assert((select equipment_id from pl_row_results where id = s_bench) is null, 'generic pick leaves sets unstamped');

  -- A past workout's record is fixed without touching what's current.
  j := public.equipment_choose(c, squat, rack_home, day2, true);
  perform t_assert((j->>'restamped')::int = 1 and (select equipment_id from pl_row_results where id = s_old) = rack_home, 'past workout fixed');
  perform t_assert(public.athlete_current_equipment(c, squat) = rack, 'fixing a past workout keeps the current pick');
  begin
    perform public.equipment_choose(c, squat, rack, gen_random_uuid());
    raise exception 'an exercise that isn''t in the workout should fail';
  exception when no_data_found then perform t_assert(true, 'choose checks the exercise is in that workout');
  end;

  -- Remove: never used = deleted; on a set = retired (kept, out of the pickers).
  perform t_assert(public.equipment_remove(thing) = 'deleted', 'unused equipment deleted');
  perform t_assert(not exists (select 1 from athlete_equipment where id = thing), 'it''s gone');
  perform t_assert(public.equipment_remove(rack_home) = 'archived', 'used equipment retired');
  perform t_assert((select archived_at from athlete_equipment where id = rack_home) is not null, 'retired, still there for history');
  perform t_assert((select count(*) from pl_row_results where equipment_id = rack_home) >= 1, 'history keeps pointing at it');
  begin
    perform public.equipment_choose(c, squat, rack_home, day);
    raise exception 'choosing retired equipment should fail';
  exception when no_data_found then perform t_assert(true, 'retired equipment can''t be picked');
  end;
  -- retired is never current
  update athlete_exercise_setups set last_used_at = now() + interval '1 minute' where equipment_id = rack_home and exercise_id = squat;
  perform t_assert(public.athlete_current_equipment(c, squat) = rack, 'retired equipment is never current');
  -- a replacement can take the name; then the old one can't come back under it
  rack_home2 := (public.equipment_save(c, 'Rogue rack', 'rack', home)->>'id')::uuid;
  perform t_assert(rack_home2 <> rack_home, 'a replacement takes the retired one''s name');
  begin
    perform public.equipment_restore(rack_home);
    raise exception 'restoring onto a taken name should fail';
  exception when unique_violation then perform t_assert(true, 'restore refuses a name clash');
  end;
  perform public.equipment_save(c, 'New Rogue rack', 'rack', home, null, null, null, null, rack_home2);
  perform public.equipment_restore(rack_home);
  perform t_assert((select archived_at from athlete_equipment where id = rack_home) is null, 'restored');

  -- A set waiting in an exercise's trash keeps its equipment from being deleted.
  trash_bench := (public.equipment_save(c, 'Trash bench', 'bench', home)->>'id')::uuid;
  insert into pl_exercise_row_trash(row_id, results) values (gen_random_uuid(), jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'equipment_id', trash_bench)));
  perform t_assert(public.equipment_remove(trash_bench) = 'archived', 'equipment on a trashed set is retired, not deleted');

  -- Removing a gym: its used equipment retired, unused deleted, the gym retired while it holds history.
  spare := (public.equipment_save(c, 'Spare bench', 'bench', gold)->>'id')::uuid;
  j := public.equipment_gym_remove(gold);
  perform t_assert(j->>'gym' = 'archived' and (j->>'retired')::int = 2 and (j->>'deleted')::int = 1, 'gym removal: 2 retired, 1 deleted, gym retired');
  perform t_assert(public.athlete_current_equipment(c, squat) = rack_home and public.athlete_current_equipment(c, rowex) = row_home, 'retired equipment steps aside: the most recent one still in use is current');
  empty_gym := (public.equipment_gym_save(c, 'Hotel gym')->>'id')::uuid;
  perform public.equipment_save(c, 'Hotel rack', 'rack', empty_gym);
  j := public.equipment_gym_remove(empty_gym);
  perform t_assert(j->>'gym' = 'deleted', 'a gym with no history is deleted');
  perform public.equipment_restore(rack);
  perform t_assert((select archived_at from athlete_gyms where id = gold) is null, 'restoring equipment brings its gym back');

  -- Setup remove keeps logged sets as they are.
  perform public.equipment_setup_remove((select id from athlete_exercise_setups where client_id = c and exercise_id = squat and equipment_id = rack));
  perform t_assert((select count(*) from pl_row_results where equipment_id = rack) >= 1, 'removing a setup never touches logged sets');

  -- Favorites.
  perform public.equipment_set_favorite(row_gold, true);
  perform t_assert((select favorite from athlete_equipment where id = row_gold), 'favorite on');

  -- Who may: a stranger can't; the coach can (and is the source); an admin can.
  perform t_as(stranger);
  begin
    perform public.equipment_gym_save(c, 'Sneaky');
    raise exception 'a stranger should be refused';
  exception when insufficient_privilege then perform t_assert(true, 'stranger refused');
  end;
  begin
    perform public.equipment_choose(c, squat, null, day);
    raise exception 'a stranger choosing should be refused';
  exception when insufficient_privilege then perform t_assert(true, 'stranger can''t switch equipment');
  end;
  begin
    perform public.equipment_remove(row_gold);
    raise exception 'a stranger removing should be refused';
  exception when insufficient_privilege then perform t_assert(true, 'stranger can''t remove equipment');
  end;
  perform t_as(coach_user);
  s := public.equipment_setup_save(c, bench, null, '[{"label":"Bench","value":"3"}]'::jsonb, null, null, true);
  perform t_assert(s->>'source' = 'coach', 'coach''s setup is marked as the coach''s');
  perform t_assert(public.athlete_current_equipment(c, bench) is null, 'coach can assign a generic setup');
  perform t_as(admin_user);
  perform public.equipment_gym_save(c, 'Admin added');

  -- Merge: a duplicate exercise's setups move to the canonical one.
  perform t_as(athlete);
  perform public.equipment_setup_save(c, squat_dupe, row_gold, '[{"label":"Pin","value":"7"}]'::jsonb);
  insert into exercise_dedupe_audit(duplicate_id, canonical_id) values (squat_dupe, squat);
  perform t_assert(exists (select 1 from athlete_exercise_setups where exercise_id = squat and equipment_id = row_gold), 'duplicate''s setup moved');
  perform t_assert(not exists (select 1 from athlete_exercise_setups where exercise_id = squat_dupe), 'nothing left on the duplicate');

  insert into t_ids values ('athlete', athlete), ('coach_user', coach_user), ('stranger', stranger), ('admin_user', admin_user), ('c', c), ('c2', c2);
end $$;

-- Reads go through RLS: own, coach, admin; never a stranger. No direct writes.
grant usage on schema public, auth, storage to authenticated;
grant select on all tables in schema public to authenticated;
grant all on auth_ctx to authenticated;
grant select on t_ids to authenticated;
set role authenticated;
select t_as(t_id('stranger'));
select t_assert((select count(*) from athlete_equipment) = 0, 'stranger sees no equipment');
select t_assert((select count(*) from athlete_exercise_setups) = 0, 'stranger sees no setups');
select t_as(t_id('athlete'));
select t_assert((select count(*) from athlete_equipment) > 0, 'athlete sees their equipment');
select t_assert((select count(*) from athlete_gyms) > 0, 'athlete sees their gyms');
select t_as(t_id('coach_user'));
select t_assert((select count(*) from athlete_exercise_setups) > 0, 'coach sees their client''s setups');
select t_as(t_id('admin_user'));
select t_assert((select count(*) from athlete_equipment) > 0, 'admin sees equipment');
select t_as(t_id('athlete'));
do $$ begin
  begin
    insert into athlete_gyms(client_id, name) values (t_id('c'), 'Direct');
    raise exception 'direct insert should be refused';
  exception when insufficient_privilege then raise notice 'ok: direct writes refused';
  end;
end $$;
reset role;
