-- All-Time Strength Board scenarios, modeled on real logging patterns
-- (including the typos found in production data).

do $$
declare
  jared uuid := t_client('Jared M', 'male');
  dwayne uuid := t_client('Dwayne G', 'male');
  vicky uuid := t_client('Vicky T');           -- no sex on the client; curated profile says male
  alyssa uuid := t_client('Alyssa B', 'female');
  nicole uuid := t_client('Nicole Y', 'female');
  jarrett uuid := t_client('Jarrett S');        -- sex never answered
  shy uuid := t_client('Pat Q', 'unspecified'); -- prefer not to say (curated says male)
  gone uuid := t_client('Archie V', 'male');
  jumpy uuid := t_client('Jamie J', 'male');
  steady uuid := t_client('Jo K', 'male');
  coach_uid uuid := gen_random_uuid();
  extra uuid; me13 uuid; r record; n int; rid uuid;
begin
  insert into user_roles values (coach_uid, 'coach');
  insert into powerlifting_athletes (client_id, sex) values (vicky, 'Male'), (shy, 'male');

  -- Jared: elite lightweight. 146 lb in Aug, 154 lb in Oct.
  perform t_bw(jared, 146, '2026-08-03'); perform t_bw(jared, 154, '2026-10-01');
  perform t_set(jared, 'Competition Squat', 242.5, 'kg', 1, wpg('2026-08-05 10:00'));
  perform t_set(jared, 'Competition Squat', 230, 'kg', 2, wpg('2026-07-20 10:00'));
  perform t_set(jared, 'Competition Bench', 152.5, 'kg', 1, wpg('2026-08-05 11:00'));
  perform t_set(jared, 'Competition Bench', 147.5, 'kg', 2, wpg('2026-07-21 10:00'));
  perform t_set(jared, 'Competition Deadlift', 270, 'kg', 1, wpg('2026-09-21 10:00'));
  perform t_set(jared, 'Competition Deadlift', 262.5, 'kg', 1, wpg('2026-09-07 10:00'));
  perform t_bw(jared, 147, '2026-09-20');

  -- Dwayne: heavy and strong. 203 lb.
  perform t_bw(dwayne, 203, '2026-08-30');
  perform t_set(dwayne, 'Competition Squat', 270, 'kg', 1, wpg('2026-08-31 10:00'));
  perform t_set(dwayne, 'Competition Squat', 250, 'kg', 3, wpg('2026-08-10 10:00'));
  perform t_set(dwayne, 'Competition Bench', 180, 'kg', 1, wpg('2026-08-31 11:00'));
  perform t_set(dwayne, 'Competition Bench', 170, 'kg', 2, wpg('2026-08-11 10:00'));
  perform t_set(dwayne, 'Competition Deadlift', 315, 'kg', 2, wpg('2026-08-17 10:00'));
  perform t_set(dwayne, 'Competition Deadlift', 292.5, 'kg', 1, wpg('2026-08-03 10:00'));

  -- Vicky: logs in lb, no bodyweight ever.
  perform t_set(vicky, 'Competition Squat', 585, 'lb', 1, wpg('2026-09-19 10:00'));
  perform t_set(vicky, 'Competition Squat', 550, 'lb', 2, wpg('2026-09-05 10:00'));
  perform t_set(vicky, 'Competition Bench', 350, 'lb', 1, wpg('2026-08-14 10:00'));
  perform t_set(vicky, 'Competition Bench', 335, 'lb', 2, wpg('2026-08-01 10:00'));
  perform t_set(vicky, 'Competition Deadlift', 610, 'lb', 1, wpg('2026-09-19 11:00'));
  perform t_set(vicky, 'Competition Deadlift', 585, 'lb', 1, wpg('2026-09-01 10:00'));

  -- Alyssa: the 755 lb bench typo (x6, three sets) next to her real numbers. 167 lb.
  perform t_bw(alyssa, 167, '2026-06-15');
  perform t_set(alyssa, 'Competition Bench', 755.3467, 'lb', 6, wpg('2026-06-18 10:00'), 3);
  perform t_set(alyssa, 'Competition Bench', 75, 'lb', 6, wpg('2026-06-25 10:00'));
  perform t_set(alyssa, 'Competition Squat', 115, 'lb', 2, wpg('2026-09-05 10:00'));
  perform t_set(alyssa, 'Competition Deadlift', 185, 'lb', 1, wpg('2026-09-05 11:00'));
  perform t_bw(alyssa, 162, '2026-09-04');

  -- Nicole: 116 lb.
  perform t_bw(nicole, 116, '2026-07-15');
  perform t_set(nicole, 'Competition Squat', 90, 'kg', 1, wpg('2026-07-17 10:00'));
  perform t_set(nicole, 'Competition Bench', 50, 'kg', 1, wpg('2026-07-17 11:00'));
  perform t_set(nicole, 'Competition Deadlift', 110, 'kg', 1, wpg('2026-07-18 10:00'));

  -- Jarrett: 146 lb; squat typo 305 kg x5 (real is ~150), bench 185 typed as kg every time.
  perform t_bw(jarrett, 146, '2026-10-01');
  perform t_set(jarrett, 'Competition Squat', 305, 'kg', 5, wpg('2026-10-05 10:00'), 2);
  perform t_set(jarrett, 'Competition Squat', 150, 'kg', 3, wpg('2026-09-28 10:00'));
  perform t_set(jarrett, 'Competition Bench', 185, 'kg', 6, wpg('2026-10-05 11:00'), 2);
  perform t_set(jarrett, 'Competition Deadlift', 165, 'kg', 4, wpg('2026-10-07 10:00'));

  -- Pat: strong but chose "prefer not to say".
  perform t_bw(shy, 180, '2026-08-01');
  perform t_set(shy, 'Competition Deadlift', 250, 'kg', 1, wpg('2026-08-02 10:00'));

  -- Archived client and non-competition exercises never count.
  update clients set archived = true where id = gone;
  perform t_set(gone, 'Competition Squat', 400, 'kg', 1, wpg('2026-08-01 10:00'));
  perform t_set(jared, 'High Bar Squat', 300, 'kg', 1, wpg('2026-08-01 10:00'));

  -- Jamie: every other session tops out at 100 kg; a 140 single (+40%) is a jump.
  -- Jo: 100 then a 130 single (+30%) is a real PR and counts.
  perform t_bw(jumpy, 200, '2026-08-01');
  perform t_set(jumpy, 'Competition Bench', 100, 'kg', 1, wpg('2026-08-02 10:00'));
  perform t_set(jumpy, 'Competition Bench', 140, 'kg', 1, wpg('2026-08-16 10:00'));
  perform t_bw(steady, 200, '2026-08-01');
  perform t_set(steady, 'Competition Bench', 100, 'kg', 1, wpg('2026-08-02 10:00'));
  perform t_set(steady, 'Competition Bench', 130, 'kg', 1, wpg('2026-08-09 10:00'));

  -- 1. The typo shield.
  perform t_assert((select flag from strength_board_sets() where client_id = alyssa and load_kg > 300 limit 1) = 'Heavier than the world record',
    '755 lb bench x6 is held back (heavier than the world record)');
  perform t_assert((select flag from strength_board_sets() where client_id = jarrett and lift = 'squat' and load_kg = 305 limit 1) = 'Too many times bodyweight to be real',
    'Jarrett 305 kg x5 squat at 146 lb is held back');
  perform t_assert((select flag from strength_board_sets() where client_id = jarrett and lift = 'bench' limit 1) = 'Too many times bodyweight to be real',
    'Jarrett 185 "kg" x6 bench at 146 lb is held back');
  perform t_assert((select flag from strength_board_sets() where client_id = jumpy and load_kg = 140) = 'Big jump over every other session',
    '140 single when every other session tops out at 100 is held back (+40%)');
  perform t_assert((select flag from strength_board_sets() where client_id = steady and load_kg = 130) is null,
    '130 single after 100 counts (+30% is a real PR)');
  perform t_assert((select count(*) from strength_board_sets() where client_id = jared and flag is not null) = 0,
    'real elite lifts (270 kg deadlift at 147 lb = 4.05x) pass');
  perform t_assert((select count(*) from strength_board_sets() where client_id = dwayne and flag is not null) = 0,
    '315 kg x2 deadlift at 203 lb passes');
  perform t_assert(not exists (select 1 from strength_board_sets() where client_id = gone), 'archived clients never count');
  perform t_assert(not exists (select 1 from strength_board_sets() where load_kg = 300), 'non-competition exercises never count');

  -- 2. Bodyweight closest to the lift.
  perform t_assert((select bw_kg from strength_board_sets() where client_id = jared and lift = 'squat' and load_kg = 242.5) = 66.2,
    'Aug squat uses the Aug bodyweight (146 lb), not the Oct one');

  -- 3. Absolute boards (Men).
  select * into r from get_strength_board(t_uid(jared)) where client_id = dwayne and lift = 'total';
  perform t_assert(r.kg = 765 and r.abs_rank = 1, 'Dwayne #1 men''s total: 270 + 180 + 315 = 765 kg');
  select * into r from get_strength_board(t_uid(jared)) where client_id = vicky and lift = 'total';
  perform t_assert(r.abs_rank = 2 and r.sex = 'male', 'Vicky #2 men''s total, sex from the curated profile');
  perform t_assert(r.p4p_rank is null and r.bw_multiple is null, 'Vicky has no bodyweight, so no pound-for-pound');
  select * into r from get_strength_board(t_uid(jared)) where client_id = jared and lift = 'total';
  perform t_assert(r.kg = 665 and r.abs_rank = 3, 'Jared #3 men''s total: 665 kg');
  select * into r from get_strength_board(t_uid(jared)) where client_id = jared and lift = 'deadlift';
  perform t_assert(r.kg = 270 and r.reps = 1, 'Jared deadlift = heaviest weight lifted, 270 kg');

  -- 4. Women.
  select * into r from get_strength_board(t_uid(alyssa)) where client_id = alyssa and lift = 'bench';
  perform t_assert(r.kg = 34.0 and r.reps = 6, 'Alyssa''s counted bench is her real 75 lb x6, not the typo');
  select * into r from get_strength_board(t_uid(alyssa)) where client_id = nicole and lift = 'total';
  perform t_assert(r.abs_rank = 1 and r.sex = 'female', 'Nicole #1 women''s total');

  -- 5. Pound for pound: one board, DOTS ranked, x bodyweight shown.
  select * into r from get_strength_board(t_uid(jared)) where client_id = jared and lift = 'total';
  perform t_assert(r.p4p_rank = 1, 'Jared #1 pound for pound (665 kg at 147 lb beats 765 kg at 203 lb)');
  perform t_assert(r.bw_kg = 66.7, 'total uses the heaviest of the three lifts'' bodyweights (147 lb)');
  perform t_assert(r.bw_multiple = 9.97, 'total x bodyweight = 665 / 66.7');
  perform t_assert(r.dots = dots_points('male', 66.7, 665), 'DOTS from the real formula');
  select * into r from get_strength_board(t_uid(jared)) where client_id = dwayne and lift = 'total';
  perform t_assert(r.p4p_rank = 2, 'Dwayne #2 pound for pound');
  select * into r from get_strength_board(t_uid(jared)) where client_id = nicole and lift = 'total';
  perform t_assert(r.p4p_rank = 3, 'Nicole #3 pound for pound: women and men on one board');

  -- 6. Unranked athletes still see themselves.
  select * into r from get_strength_board(t_uid(jarrett)) where client_id = jarrett and lift = 'squat';
  perform t_assert(r.is_me and r.kg = 150 and r.abs_rank is null and r.p4p_rank is null,
    'Jarrett sees his real 150 kg squat, unranked until he picks a division');
  perform t_assert(not exists (select 1 from get_strength_board(t_uid(jarrett)) where client_id = jarrett and lift in ('bench', 'total')),
    'no counted bench yet, so no total');
  perform t_assert(not exists (select 1 from get_strength_board(t_uid(jared)) where client_id = jarrett),
    'unranked athletes are not shown to others');
  select * into r from get_strength_board(t_uid(shy)) where client_id = shy and lift = 'deadlift';
  perform t_assert(r.sex is null and r.abs_rank is null, '"Prefer not to say" wins over the curated profile');
  update clients set sex = 'male' where id = jarrett;
  select * into r from get_strength_board(t_uid(jarrett)) where client_id = jarrett and lift = 'squat';
  perform t_assert(r.abs_rank is not null and r.p4p_rank is not null, 'picking a division ranks him immediately');

  -- 7. Top 10 only, plus the viewer.
  for i in 1..12 loop
    extra := t_client('Lifter ' || i, 'male');
    perform t_bw(extra, 180, '2026-09-01');
    perform t_set(extra, 'Competition Squat', 100 + i, 'kg', 1, wpg('2026-09-02 10:00'));
    if i = 1 then me13 := extra; end if;
  end loop;
  perform t_assert((select count(*) from get_strength_board(t_uid(jared)) where lift = 'squat' and sex = 'male' and abs_rank > 10) = 0,
    'others outside the top 10 are not returned');
  select * into r from get_strength_board(t_uid(me13)) where client_id = me13 and lift = 'squat';
  perform t_assert(r.abs_rank > 10 and r.abs_count >= 16, 'the viewer outside the top 10 still gets their rank and the board size');

  -- 8. Coach review.
  delete from auth_ctx; insert into auth_ctx values (t_uid(jared));
  begin
    perform * from get_strength_board_review();
    raise exception 'non-staff read the review queue';
  exception when insufficient_privilege then perform t_assert(true, 'review queue is staff only');
  end;
  delete from auth_ctx; insert into auth_ctx values (coach_uid);
  select * into r from get_strength_board_review() where client_id = alyssa and lift = 'bench';
  perform t_assert(r.sets = 3 and r.flag = 'Heavier than the world record', 'queue shows the 755 lb typo once, covering its 3 sets');
  perform t_assert(not exists (select 1 from get_strength_board_review() where client_id = steady), 'lifts that already count are not queued');

  perform t_assert((select missing from get_strength_board_unranked() where client_id = vicky) = 'bodyweight',
    'coach list: Vicky needs a bodyweight for pound for pound');
  perform t_assert((select missing from get_strength_board_unranked() where client_id = shy) = 'division',
    'coach list: "prefer not to say" needs a division to rank');
  perform t_assert(not exists (select 1 from get_strength_board_unranked() where client_id = jared), 'ranked athletes are not listed');

  perform t_assert((select load_kg from get_strength_board_tops() where client_id = dwayne and lift = 'deadlift') = 315,
    'coach list of counted tops shows Dwayne''s 315 deadlift');
  perform t_assert(not exists (select 1 from get_strength_board_tops() where client_id = alyssa and load_kg > 300),
    'held-back typos are not in the counted tops');

  -- Remove Dwayne's 315: his 292.5 takes over and the total drops.
  rid := (select result_id from strength_board_sets() where client_id = dwayne and lift = 'deadlift' and load_kg = 315 limit 1);
  n := strength_board_review(rid, 'excluded');
  perform t_assert(n = 1, 'remove applies to that day''s sets at that weight');
  select * into r from get_strength_board(t_uid(dwayne)) where client_id = dwayne and lift = 'total';
  perform t_assert(r.kg = 742.5, 'next best deadlift takes its place (270 + 180 + 292.5)');
  n := strength_board_review(rid, 'clear');
  select * into r from get_strength_board(t_uid(dwayne)) where client_id = dwayne and lift = 'total';
  perform t_assert(r.kg = 765, 'undo restores it');

  -- Approve a held-back lift.
  rid := (select result_id from strength_board_sets() where client_id = jumpy and load_kg = 140);
  perform strength_board_review(rid, 'approved');
  select * into r from get_strength_board(t_uid(jumpy)) where client_id = jumpy and lift = 'bench';
  perform t_assert(r.kg = 140, 'an approved lift counts');
  begin
    perform strength_board_review(rid, 'bogus');
    raise exception 'accepted a bad status';
  exception when others then perform t_assert(sqlerrm = 'Invalid status', 'bad status rejected');
  end;
end $$;

-- Two bodyweight logs on the same day: the most recently entered one is used
-- (the same rule as the league's current bodyweight), never an arbitrary pick.
do $$
declare dupe uuid := t_client('Dee P', 'male');
begin
  insert into progress_bodyweight (user_id, weight_value, weight_unit, logged_date, created_at)
  values (t_uid(dupe), 180, 'lb', '2026-08-01', now() - interval '1 hour'),
         (t_uid(dupe), 190, 'lb', '2026-08-01', now());
  perform t_set(dupe, 'Competition Squat', 150, 'kg', 1, wpg('2026-08-01 10:00'));
  perform t_assert((select bw_kg from strength_board_sets() where client_id = dupe) = 86.2,
    'same-day duplicate bodyweight: the newest entry (190 lb) is used');
end $$;
