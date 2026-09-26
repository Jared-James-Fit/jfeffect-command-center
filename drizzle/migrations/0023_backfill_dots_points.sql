-- Keep both scoring systems on every full-power meet row.
update public.athlete_powerlifting_results
set dots_points=round((total_kg*500/(case
 when lower(sex)='male' then -0.000001093*power(bodyweight_kg,4)+0.0007391293*power(bodyweight_kg,3)-0.1918759221*power(bodyweight_kg,2)+24.0900756*bodyweight_kg-307.75076
 else -0.0000010706*power(bodyweight_kg,4)+0.0005158568*power(bodyweight_kg,3)-0.1126655495*power(bodyweight_kg,2)+13.6175032*bodyweight_kg-57.96288 end))::numeric,2)
where dots_points is null and bodyweight_kg>0 and total_kg>0 and squat_kg>0 and bench_kg>0 and deadlift_kg>0 and lower(sex) in ('male','female');