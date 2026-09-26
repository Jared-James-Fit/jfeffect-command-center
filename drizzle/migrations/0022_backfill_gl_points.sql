-- Backfill IPF GL Points for classic full-power results from the stored meet bodyweight and total.
-- Official IPF GL coefficients (2020): men classic PL 1199.72839/1025.18162/0.00921; women 610.32796/1045.59282/0.03048.
update public.athlete_powerlifting_results
set gl_points = round((
  total_kg * 100 / case
    when lower(sex)='male' then (1199.72839 - 1025.18162 * exp(-0.00921 * bodyweight_kg))
    when lower(sex)='female' then (610.32796 - 1045.59282 * exp(-0.03048 * bodyweight_kg))
  end
)::numeric, 2)
where bodyweight_kg > 0
  and total_kg > 0
  and squat_kg > 0
  and bench_kg > 0
  and deadlift_kg > 0
  and lower(sex) in ('male','female');
