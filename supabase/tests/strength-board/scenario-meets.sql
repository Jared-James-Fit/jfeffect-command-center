-- JF Effect meet history (20261017120000_hall_of_strength_meets.sql).
-- Run after scenario.sql's schema + migrations; independent of its data.
do $$
declare
  nicole uuid := t_client('Nicole Yusi', 'female');
  a_nic uuid; a_old uuid; a_us uuid; a_bench uuid;
  r record;
  n int;
begin
  update clients set full_name = 'Nicole Yusi' where id = nicole;
  insert into powerlifting_athletes (client_id, athlete_name, sex) values (nicole, 'Nicole Yusi', 'female') returning id into a_nic; -- profile renamed on linking
  insert into powerlifting_athletes (athlete_name, sex, status) values ('Old Timer', 'male', 'retired') returning id into a_old;
  insert into powerlifting_athletes (athlete_name, sex, country_filter) values ('Border Guy', 'male', 'Canada') returning id into a_us;
  insert into powerlifting_athletes (athlete_name, sex) values ('Bench Only', 'male') returning id into a_bench;
  insert into powerlifting_coaching_periods (athlete_id, start_date, end_date) values
    (a_nic, null, null), (a_old, '2020-01-01', '2022-12-31'), (a_us, null, null), (a_bench, null, null);

  insert into athlete_powerlifting_results (athlete_id, athlete_name, sex, bodyweight_kg, squat_kg, bench_kg, deadlift_kg, total_kg, meet_name, meet_location, meet_date, gl_points) values
    -- Lighter meet: more x bodyweight; heavier meet: heavier total.
    (a_nic, 'Nicole Carta', 'female', 52, 80, 50, 100, 230, 'Provincials', 'Canada-MB', '2024-03-01', 70),
    (a_nic, 'Nicole Carta', 'female', 58, 85, 52.5, 102.5, 240, 'Nationals', 'Canada-ON', '2025-03-01', 68),
    (a_old, 'Old Timer', 'male', 90, 200, 140, 250, 590, 'Inside', 'Canada', '2021-06-01', 80),
    (a_old, 'Old Timer', 'male', 90, 300, 200, 350, 850, 'After he left', 'Canada', '2023-06-01', 99),
    (a_us, 'Border Guy', 'male', 80, 200, 150, 250, 600, 'Away meet', 'USA-TX', '2024-01-01', 90),
    (a_us, 'Border Guy', 'male', 80, 190, 140, 240, 570, 'Home meet', 'Canada-MB', '2024-06-01', 85),
    (a_bench, 'Bench Only', 'male', 100, null, 180, null, 180, 'Bench meet', 'Canada', '2024-06-01', null);

  delete from auth_ctx;
  perform t_assert(not exists (select 1 from get_strength_board_meets(null)), 'signed out: no meet board');

  perform t_assert((select count(distinct athlete_id) from get_strength_board_meets(t_uid(nicole))) = 4, 'every tracked athlete with a qualifying meet is on it');

  select * into r from get_strength_board_meets(t_uid(nicole)) where athlete_id = a_nic and lift = 'total' and all_rank is not null;
  perform t_assert(r.kg = 240 and r.meet_name = 'Nationals' and r.abs_rank is not null and r.p4p_rank is null,
    'absolute uses the heaviest meet');
  perform t_assert(r.display_name = 'Nicole Yusi' and r.competed_as = 'Nicole Carta' and r.is_me and r.client_id = nicole,
    'linked client shows her current name, the name on her meet results, and is "me"');
  perform t_assert(r.sex = 'female' and r.abs_rank = 1 and r.abs_count = 1, 'women ranked separately on absolute');
  select * into r from get_strength_board_meets(t_uid(nicole)) where athlete_id = a_nic and lift = 'total' and p4p_rank is not null;
  perform t_assert(r.kg = 230 and r.bw_multiple = 4.42 and r.all_rank is null and r.p4p_count = 3,
    'pound for pound uses her best x-bodyweight meet, which can be a different one');

  select * into r from get_strength_board_meets(t_uid(nicole)) where athlete_id = a_old and lift = 'total';
  perform t_assert(r.kg = 590 and r.is_alumni and r.competed_as is null and r.client_id is null,
    'meets after the coaching period don''t count; retired athletes stay as alumni');

  select * into r from get_strength_board_meets(t_uid(nicole)) where athlete_id = a_us and lift = 'total';
  perform t_assert(r.kg = 570, 'country filter applies');

  perform t_assert(not exists (select 1 from get_strength_board_meets(t_uid(nicole)) where athlete_id = a_bench and lift = 'total')
    and exists (select 1 from get_strength_board_meets(t_uid(nicole)) where athlete_id = a_bench and lift = 'bench' and kg = 180 and all_rank = 1),
    'a bench-only meet counts for bench, never a total');

  select count(*) into n from get_strength_board_meets(t_uid(nicole)) where lift = 'total' and all_rank is not null;
  perform t_assert(n = 3 and (select max(all_count) from get_strength_board_meets(t_uid(nicole)) where lift = 'total') = 3,
    'one absolute spot per athlete');
  perform t_assert((select sum(m) from (select distinct athlete_id, athlete_meets m from get_strength_board_meets(t_uid(nicole))) z) = 5
    and (select min(first_meet) from get_strength_board_meets(t_uid(nicole))) = '2021-06-01',
    'history counts only qualifying meets');
end $$;
