-- Setup photos, earlier versions and restore (20270602090000_setup_autosave_history_photos.sql).
-- Run after schema.sql, both migrations and scenario.sql (see README.md).
\set ON_ERROR_STOP 1
set client_min_messages = notice;

do $$
declare
  athlete uuid := gen_random_uuid();
  coach_user uuid := gen_random_uuid();
  coach uuid; c uuid; other_c uuid;
  ex uuid; ex2 uuid; ex_dupe uuid;
  rack uuid; spare uuid;
  s jsonb; s_id uuid; rev uuid; n int;
begin
  insert into coaches(user_id) values (coach_user) returning id into coach;
  insert into clients(user_id, assigned_coach_id, full_name) values (athlete, coach, 'Devin') returning id into c;
  insert into clients(user_id, full_name) values (gen_random_uuid(), 'Other') returning id into other_c;
  insert into exercises(name) values ('Leg Press') returning id into ex;
  insert into exercises(name) values ('Seated Row') returning id into ex2;
  insert into exercises(name) values ('Leg Press (dupe)') returning id into ex_dupe;
  perform t_as(athlete);
  rack := (public.equipment_save(c, 'Leg press', 'machine')->>'id')::uuid;
  spare := (public.equipment_save(c, 'Spare', 'machine')->>'id')::uuid;

  -- Photos: several, in order, cleaned; photo_path is the first.
  s := public.equipment_setup_save(c, ex, rack, '[{"label":"Seat","value":"4"}]'::jsonb, null, null, true,
         array[c::text || '/a.jpg', ' ' || c::text || '/b.jpg ', c::text || '/a.jpg', '', null]);
  s_id := (s->>'id')::uuid;
  perform t_assert((select photo_paths from athlete_exercise_setups where id = s_id) = array[c::text || '/a.jpg', c::text || '/b.jpg'], 'photos kept in order, trimmed, no blanks or repeats');
  perform t_assert((select photo_path from athlete_exercise_setups where id = s_id) = c::text || '/a.jpg', 'photo_path is the first photo');
  begin
    perform public.equipment_setup_save(c, ex, rack, '[]'::jsonb, null, null, false, array[other_c::text || '/x.jpg']);
    raise exception 'someone else''s photo should be refused';
  exception when insufficient_privilege then perform t_assert(true, 'a photo outside their folder refused');
  end;
  begin
    perform public.equipment_setup_save(c, ex, rack, '[]'::jsonb, null, null, false,
      array[c::text || '/1.jpg', c::text || '/2.jpg', c::text || '/3.jpg', c::text || '/4.jpg', c::text || '/5.jpg']);
    raise exception 'five photos should be refused';
  exception when invalid_parameter_value then perform t_assert(true, 'at most 4 photos');
  end;

  -- An older app (7 arguments, one photo): only the first photo changes.
  s := public.equipment_setup_save(c, ex, rack, '[{"label":"Seat","value":"4"}]'::jsonb, null, c::text || '/new.jpg', false);
  perform t_assert((select photo_paths from athlete_exercise_setups where id = s_id) = array[c::text || '/new.jpg', c::text || '/b.jpg'], 'an older app replaces the first photo only');
  s := public.equipment_setup_save(c, ex, rack, '[{"label":"Seat","value":"4"}]'::jsonb, null, null, false);
  perform t_assert((select photo_paths from athlete_exercise_setups where id = s_id) = array[c::text || '/b.jpg'], 'an older app removing its photo leaves the rest');
  perform t_assert((select photo_path from athlete_exercise_setups where id = s_id) = c::text || '/b.jpg', 'and photo_path follows');

  -- Folding: the same person's saves moments apart are one session, one version.
  delete from athlete_exercise_setup_revisions;
  s := public.equipment_setup_save(c, ex, rack, '[{"label":"Seat","value":"5"}]'::jsonb, null, null, false, '{}'::text[]);
  perform t_assert((select count(*) from athlete_exercise_setup_revisions where setup_id = s_id) = 0, 'saves a moment apart by the same person keep no version');
  -- an hour later, a new session: the state before it is kept
  update athlete_exercise_setups set updated_at = now() - interval '1 hour' where id = s_id;
  s := public.equipment_setup_save(c, ex, rack, '[{"label":"Seat","value":"7"}]'::jsonb, 'Feet high', null, false, '{}'::text[]);
  perform t_assert((select count(*) from athlete_exercise_setup_revisions where setup_id = s_id) = 1, 'a new session keeps the version before it');
  perform t_assert((select settings->0->>'value' from athlete_exercise_setup_revisions where setup_id = s_id) = '5', 'the kept version is the one replaced');
  s := public.equipment_setup_save(c, ex, rack, '[{"label":"Seat","value":"8"}]'::jsonb, 'Feet high', null, false, '{}'::text[]);
  perform t_assert((select count(*) from athlete_exercise_setup_revisions where setup_id = s_id) = 1, 'the rest of that session folds into it');

  -- A pick (last_used_at only) is not a change.
  perform public.equipment_choose(c, ex, rack);
  perform t_assert((select count(*) from athlete_exercise_setup_revisions where setup_id = s_id) = 1, 'a pick keeps no version');

  -- The coach saving over the athlete's version always keeps it, and vice versa.
  perform t_as(coach_user);
  s := public.equipment_setup_save(c, ex, rack, '[{"label":"Seat","value":"6"}]'::jsonb, 'Feet high', null, false, '{}'::text[]);
  perform t_assert((select count(*) from athlete_exercise_setup_revisions where setup_id = s_id) = 2, 'the coach''s save keeps the athlete''s version');
  perform t_assert((select saved_by from athlete_exercise_setup_revisions where setup_id = s_id order by created_at desc, id desc limit 1) = athlete, 'it says who wrote it');
  perform t_as(athlete);
  s := public.equipment_setup_save(c, ex, rack, '[{"label":"Seat","value":"9"}]'::jsonb, null, null, false, '{}'::text[]);
  perform t_assert((select count(*) from athlete_exercise_setup_revisions where setup_id = s_id) = 3, 'the athlete''s save over the coach''s keeps the coach''s');
  perform t_assert((select source from athlete_exercise_setup_revisions where setup_id = s_id and settings->0->>'value' = '6') = 'coach', 'the coach''s version is marked as theirs');

  -- Restore: the version comes back, and what it replaced is kept (so a restore can be undone).
  select id into rev from athlete_exercise_setup_revisions where setup_id = s_id and settings->0->>'value' = '6';
  s := public.equipment_setup_restore(rev);
  perform t_assert((select settings->0->>'value' from athlete_exercise_setups where id = s_id) = '6', 'restore puts the version back');
  perform t_assert((select notes from athlete_exercise_setups where id = s_id) = 'Feet high', 'with its note');
  perform t_assert(exists (select 1 from athlete_exercise_setup_revisions where setup_id = s_id and reason = 'restore' and settings->0->>'value' = '9'), 'what a restore replaces is kept, even moments after a save');
  perform t_assert((select count(*) from athlete_exercise_setup_revisions where setup_id = s_id) = 4, 'four versions now');

  -- Removing keeps the last version; restoring it brings the setup back.
  perform public.equipment_setup_remove(s_id);
  perform t_assert(not exists (select 1 from athlete_exercise_setups where id = s_id), 'removed');
  select id into rev from athlete_exercise_setup_revisions where setup_id = s_id and reason = 'removed';
  perform t_assert(rev is not null, 'a removal keeps what was removed');
  s := public.equipment_setup_restore(rev);
  perform t_assert(exists (select 1 from athlete_exercise_setups where client_id = c and exercise_id = ex and equipment_id = rack and settings->0->>'value' = '6'), 'a removed setup comes back');

  -- An empty setup (a bare pick) is never a version.
  perform public.equipment_choose(c, ex2, spare);
  s := public.equipment_setup_save(c, ex2, spare, '[{"label":"Chest pad","value":"2"}]'::jsonb, null, null, false, '{}'::text[]);
  perform t_assert(not exists (select 1 from athlete_exercise_setup_revisions where exercise_id = ex2), 'nothing kept for an empty setup');

  -- At most 30 per setup.
  s_id := (s->>'id')::uuid;
  for n in 1..35 loop
    update athlete_exercise_setups set updated_at = now() - interval '1 hour', updated_by = coach_user where id = s_id;
    s := public.equipment_setup_save(c, ex2, spare, jsonb_build_array(jsonb_build_object('label', 'Chest pad', 'value', n::text)), null, null, false, '{}'::text[]);
  end loop;
  perform t_assert((select count(*) from athlete_exercise_setup_revisions where setup_id = s_id) = 30, 'the newest 30 versions are kept');

  -- A version on equipment that's since been deleted can't come back.
  perform public.equipment_setup_save(c, ex_dupe, spare, '[{"label":"Pin","value":"3"}]'::jsonb, null, null, false, '{}'::text[]);
  update athlete_exercise_setups set updated_at = now() - interval '1 hour' where exercise_id = ex_dupe;
  perform public.equipment_setup_save(c, ex_dupe, spare, '[{"label":"Pin","value":"4"}]'::jsonb, null, null, false, '{}'::text[]);
  perform t_assert(exists (select 1 from athlete_exercise_setup_revisions where exercise_id = ex_dupe), 'the duplicate has a version');

  -- Merges move versions too.
  insert into exercise_dedupe_audit(duplicate_id, canonical_id) values (ex_dupe, ex2);
  perform t_assert(not exists (select 1 from athlete_exercise_setup_revisions where exercise_id = ex_dupe), 'a merged exercise''s versions move to the one it was merged into');

  -- Who may restore: never a stranger.
  perform t_as(gen_random_uuid());
  begin
    perform public.equipment_setup_restore(rev);
    raise exception 'a stranger restoring should be refused';
  exception when insufficient_privilege then perform t_assert(true, 'a stranger can''t restore');
  end;
  perform t_as(athlete);

  -- Deleting the equipment (never used on a set) keeps its setups' last versions, which can't go back on it.
  perform public.equipment_remove(spare);
  select id into rev from athlete_exercise_setup_revisions where equipment_id = spare and reason = 'removed' order by created_at desc limit 1;
  perform t_assert(rev is not null, 'deleting equipment keeps its setups'' last versions');
  begin
    perform public.equipment_setup_restore(rev);
    raise exception 'a version on deleted equipment should be refused';
  exception when no_data_found then perform t_assert(true, 'a version on deleted equipment can''t come back');
  end;

  -- The whole account going: no versions are kept, and nothing stops it.
  perform t_as(null);
  delete from clients where id = c;
  perform t_assert(not exists (select 1 from athlete_exercise_setup_revisions where client_id = c), 'an account''s versions go with it');
  perform t_assert(not exists (select 1 from athlete_exercise_setups where client_id = c), 'and its setups');
end $$;

-- Versions are read like setups (own, coach, admin; never a stranger) and never written directly.
set role authenticated;
select t_as(gen_random_uuid());
select t_assert((select count(*) from athlete_exercise_setup_revisions) = 0, 'a stranger sees no versions');
do $$ begin
  begin
    insert into athlete_exercise_setup_revisions(setup_id, client_id, exercise_id) values (gen_random_uuid(), t_id('c'), gen_random_uuid());
    raise exception 'direct insert should be refused';
  exception when insufficient_privilege then raise notice 'ok: versions can''t be written directly';
  end;
end $$;
reset role;
