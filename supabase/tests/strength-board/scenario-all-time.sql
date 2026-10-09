-- All-time board (20261024090000_hall_of_strength_all_time.sql): everyone
-- JF Effect has coached, best of training and meets. Run after scenario.sql
-- and scenario-meets.sql (uses its own people).
do $$
declare
  kim uuid := t_client('Kim Lee', 'female');      -- app client who also competes
  old uuid := t_client('Ollie Former', 'male');   -- former (archived) client, app lifts only
  a_kim uuid; a_phil uuid;
  r record;
begin
  -- Kim trains in the app: 100 squat x3, 60 bench, 110 deadlift = 270 training total.
  perform t_bw(kim, 132, '2026-09-01');
  perform t_set(kim, 'Competition Squat', 100, 'kg', 3, wpg('2026-09-02 10:00'));
  perform t_set(kim, 'Competition Bench', 60, 'kg', 1, wpg('2026-09-02 10:30'));
  perform t_set(kim, 'Competition Deadlift', 110, 'kg', 1, wpg('2026-09-03 10:00'));
  -- ...and competed lighter: 95 / 62.5 / 115 = 272.5 at 57 kg.
  insert into powerlifting_athletes (client_id, athlete_name, sex) values (kim, 'Kim Lee', 'female') returning id into a_kim;
  insert into powerlifting_athletes (athlete_name, sex, status) values ('Phillip Bennett', 'male', 'active') returning id into a_phil;
  insert into powerlifting_coaching_periods (athlete_id) values (a_kim), (a_phil);
  insert into athlete_powerlifting_results (athlete_id, athlete_name, sex, bodyweight_kg, squat_kg, bench_kg, deadlift_kg, total_kg, meet_name, meet_location, meet_date) values
    (a_kim, 'Kim Lee', 'female', 57, 95, 62.5, 115, 272.5, 'Provincials', 'Canada', '2025-05-01'),
    (a_phil, 'Phillip Bennett', 'male', 98, 240, 160, 272.5, 672.5, 'Nationals', 'Canada', '2024-06-01');

  -- Ollie left, but his lifts stay.
  perform t_bw(old, 200, '2026-06-01');
  perform t_set(old, 'Competition Squat', 200, 'kg', 1, wpg('2026-06-02 10:00'));
  update clients set archived = true, status = 'Archived' where id = old;

  delete from auth_ctx;
  perform t_assert(not exists (select 1 from get_strength_board_all(null)), 'signed out: nothing');

  select * into r from get_strength_board_all(t_uid(kim)) where person = 'c:' || kim and lift = 'squat' and all_rank is not null;
  perform t_assert(r.kg = 100 and r.source = 'training' and r.reps = 3, 'squat: the heavier training set beats the meet');
  select * into r from get_strength_board_all(t_uid(kim)) where person = 'c:' || kim and lift = 'deadlift' and all_rank is not null;
  perform t_assert(r.kg = 115 and r.source = 'meet' and r.meet_name = 'Provincials', 'deadlift: the heavier meet lift beats training');
  select * into r from get_strength_board_all(t_uid(kim)) where person = 'c:' || kim and lift = 'total' and all_rank is not null;
  perform t_assert(r.kg = 272.5 and r.source = 'meet', 'total: a real meet total vs best training total, never mixed (272.5 not 100+62.5+115)');
  perform t_assert(r.is_me and r.display_name = 'Kim L' and r.sex = 'female' and r.client_id = kim and r.athlete_id = a_kim,
    'a client who competes is one person, shown as on the app');
  perform t_assert((select count(*) from get_strength_board_all(t_uid(kim)) where person = 'c:' || kim and lift = 'total' and all_rank is not null) = 1,
    'one absolute spot per person');
  select * into r from get_strength_board_all(t_uid(kim)) where person = 'c:' || kim and lift = 'total' and p4p_rank is not null;
  perform t_assert(r.source = 'meet' and r.bw_multiple = 4.78, 'pound for pound: best x bodyweight from either source (272.5 / 57)');

  select * into r from get_strength_board_all(t_uid(kim)) where person = 'a:' || a_phil and lift = 'total';
  perform t_assert(r.display_name = 'Phillip B' and r.client_id is null and not r.is_alumni and r.kg = 672.5,
    'meet-only athletes are on it, named like everyone else');

  select * into r from get_strength_board_all(t_uid(kim)) where person = 'c:' || old and lift = 'squat';
  perform t_assert(r.kg = 200 and r.is_alumni, 'former clients'' app lifts count, tagged alumni');

  insert into auth_ctx (uid) values (gen_random_uuid());
  insert into user_roles (user_id, role) select uid, 'admin' from auth_ctx;
  perform t_assert(not exists (select 1 from get_strength_board_unranked() where client_id = old),
    'coach "can''t rank yet" list skips former clients');
  delete from auth_ctx;

  -- The training set wins a tie only if it's heavier; equal weight goes to the judged meet.
  perform t_set(kim, 'Competition Deadlift', 115, 'kg', 1, wpg('2026-09-10 10:00'));
  select * into r from get_strength_board_all(t_uid(kim)) where person = 'c:' || kim and lift = 'deadlift' and all_rank is not null;
  perform t_assert(r.source = 'meet', 'a tie goes to the meet');
end $$;
